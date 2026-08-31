import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { chromium, type BrowserContext, type Page, type CDPSession } from 'patchright';
import type {
  BrowserColorScheme,
  BrowserDeviceProfile,
  BrowserGeolocation,
  BrowserScriptInjection,
} from '../BrowserSession';
import { applyLogicalViewport } from './device-emulation';

const execFileAsync = promisify(execFile);

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function requireChromeExecutable(): string {
  const path = process.env['CHROME_EXECUTABLE'];
  if (!path?.trim()) {
    throw new Error('CHROME_EXECUTABLE environment variable is required');
  }
  return path.trim();
}

export interface ChromeHandle {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  userDataDir: string;
}

export function profileDirForSession(sessionId: string): string {
  return path.join(os.tmpdir(), 'speculum-profiles', sessionId);
}

/** Template path for the unified PageProjection extension (webgl + plane + Virtual runtime). */
export function speculumPpExtensionPath(): string {
  return path.resolve(__dirname, '../../../extensions/speculum-pp');
}

/** Per-session install dir under os.tmpdir (owns `c2-endpoint.json`; never the shared template). */
export function speculumPpSessionExtensionDir(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(os.tmpdir(), 'speculum-extensions', safe);
}

/**
 * Copy the static `speculum-pp` template into a per-session directory for `loadUnpacked`.
 * Isolates `c2-endpoint.json` so concurrent sessions cannot steal each other's C2 host.
 */
export function materializeSpeculumPpForSession(sessionId: string): string {
  const template = speculumPpExtensionPath();
  requireManagedExtensions();
  const dest = speculumPpSessionExtensionDir(sessionId);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(template, dest, { recursive: true });
  try {
    fs.unlinkSync(path.join(dest, 'c2-endpoint.json'));
  } catch {
    /* template should not ship an endpoint; ignore */
  }
  return dest;
}

/** Best-effort remove of a per-session extension directory after Chrome close. */
export function removeSpeculumPpSessionDir(dir: string): void {
  if (!dir.trim()) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function managedExtensionPaths(): string[] {
  return [speculumPpExtensionPath()];
}

function requireManagedExtensions(): void {
  for (const extPath of managedExtensionPaths()) {
    if (!fs.existsSync(extPath)) {
      const name = path.basename(extPath);
      throw Object.assign(
        new Error(`${name} extension missing at ${extPath}`),
        { code: 'FAILED_PRECONDITION', errorCode: `${name.replace(/-/g, '_')}_missing`, phase: 'launch' },
      );
    }
    const virtualJs = path.join(extPath, 'main', 'virtual.js');
    if (!fs.existsSync(virtualJs)) {
      throw Object.assign(
        new Error(`speculum-pp main/virtual.js missing at ${virtualJs} — run npm run build:virtual`),
        {
          code: 'FAILED_PRECONDITION',
          errorCode: 'speculum_pp_virtual_missing',
          phase: 'launch',
        },
      );
    }
  }
}

/**
 * Chrome launch flags. WebGL is always enabled with automatic backend selection:
 * real GPU when present, SwiftShader software fallback otherwise (no env knobs).
 * Kit UNMASKED spoof is applied in-page via device-kits init script.
 *
 * Managed extension (`speculum-pp`) is installed after launch via
 * CDP `Extensions.loadUnpacked` (see {@link installManagedExtensions}). Branded
 * Google Chrome 137+ ignores `--load-extension` / `--disable-extensions-except`;
 * `--enable-unsafe-extension-debugging` is required for that CDP path (EP-13).
 */
export function buildChromeArgs(width: number, height: number): string[] {
  // Managed Speculum Chromium: LNA exemption via enterprise policy only (loopback.md §11).
  // Fail-fast on missing extension dirs before spawn (EP-13).
  requireManagedExtensions();

  const args = [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${width},${height}`,
    '--window-position=0,0',
    '--disable-features=ExclusiveAccessBubble',
    // Required for CDP Extensions.loadUnpacked on branded Chrome (EP-13).
    '--enable-unsafe-extension-debugging',
    '--touch-events=enabled',
    '--no-first-run',
    '--mute-audio',
    // §5.3.4 bans background-throttling of the frame clock: a backgrounded/occluded
    // tab must keep emitting at frameRateHz, or the watchdog fires falsely and the
    // client silently lags. These three flags remove Chrome's own throttling paths.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // Prefer hardware ANGLE when available; allow SwiftShader when not.
    '--use-gl=angle',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
  ];

  if (process.env['SPECULUM_IGNORE_CERT_ERRORS'] === '1') {
    args.push('--ignore-certificate-errors');
  }

  if (process.env['SPECULUM_FAKE_MEDIA_DEVICES'] === '1') {
    args.push('--use-fake-device-for-media-stream');
  }

  return args;
}

/**
 * Install managed unpacked extensions via CDP (EP-13).
 * Branded Chrome no longer honors `--load-extension`; this is the supported path.
 * Must use the **browser** CDP session — page sessions return "Method not available".
 * Detach the browser CDP session after install — holding it breaks `Target.createTarget`
 * (session navigate close+newPage) on Chrome 152.
 */
export async function installManagedExtensions(
  context: BrowserContext,
  extensionPaths?: readonly string[],
): Promise<string[]> {
  const browser = context.browser();
  if (!browser || typeof browser.newBrowserCDPSession !== 'function') {
    throw Object.assign(new Error('browser CDP session unavailable for extension install'), {
      code: 'FAILED_PRECONDITION',
      errorCode: 'extension_cdp_unavailable',
      phase: 'launch',
    });
  }
  const paths = extensionPaths?.length ? [...extensionPaths] : managedExtensionPaths();
  const cdp = await browser.newBrowserCDPSession();
  const ids: string[] = [];
  try {
    for (const extPath of paths) {
      const name = path.basename(extPath);
      try {
        // Extensions domain is experimental; Patchright typings omit it on CDPSession.
        const result = await (cdp as CDPSession & {
          send(method: 'Extensions.loadUnpacked', params: { path: string }): Promise<{ id: string }>;
        }).send('Extensions.loadUnpacked', { path: extPath });
        if (!result?.id || typeof result.id !== 'string') {
          throw new Error(`${name}: loadUnpacked returned no id`);
        }
        ids.push(result.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw Object.assign(
          new Error(`${name} extension failed to load via CDP: ${message}`),
          {
            code: 'FAILED_PRECONDITION',
            errorCode: `${name.replace(/-/g, '_')}_load_failed`,
            phase: 'launch',
          },
        );
      }
    }
  } finally {
    try {
      await cdp.detach();
    } catch {
      /* best-effort */
    }
  }
  return ids;
}

export async function launchChrome(args: {
  sessionId: string;
  /** X11 DISPLAY (e.g. `:100`). Omit on Windows/macOS native headed — do not invent DISPLAY. */
  displayEnv?: string;
  /** Default false (visible). PP sparse-cdp honors lab/factory headless. */
  headless?: boolean;
  width: number;
  height: number;
  locale: string;
  language: string;
  timeZoneId: string;
  colorScheme: BrowserColorScheme;
  geolocation?: BrowserGeolocation;
  device?: BrowserDeviceProfile;
  preserveUserDataDir?: boolean;
  /** Merged into Playwright extraHTTPHeaders (e.g. lab ngrok skip). */
  extraHTTPHeaders?: Readonly<Record<string, string>>;
  /** Per-session unpacked extension dirs (default: shared template — PP must pass a materialized copy). */
  extensionPaths?: readonly string[];
}): Promise<ChromeHandle> {
  if (!Number.isFinite(args.width) || !Number.isFinite(args.height) || args.width <= 0 || args.height <= 0) {
    throw Object.assign(new Error('launch requires positive width and height'), {
      code: 'INVALID_ARGUMENT',
    });
  }
  if (!args.locale.trim() || !args.language.trim() || !args.timeZoneId.trim() || !args.colorScheme) {
    throw Object.assign(new Error('launch requires locale, language, timeZoneId, and colorScheme'), {
      code: 'INVALID_ARGUMENT',
    });
  }

  const chromeExecutable = requireChromeExecutable();
  const userDataDir = profileDirForSession(args.sessionId);

  if (!args.preserveUserDataDir) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (args.displayEnv) {
    env.DISPLAY = args.displayEnv;
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: args.headless === true,
    executablePath: chromeExecutable,
    // Playwright defaults include --disable-extensions; keep extensions enabled for CDP load.
    ignoreDefaultArgs: ['--disable-extensions'],
    env,
    args: buildChromeArgs(args.width, args.height),
    viewport: null,
    locale: args.locale,
    timezoneId: args.timeZoneId,
    colorScheme: args.colorScheme,
    extraHTTPHeaders: {
      'Accept-Language': args.language,
      ...args.extraHTTPHeaders,
    },
  });

  let page = context.pages()[0];
  if (!page) page = await context.newPage();

  await installManagedExtensions(context, args.extensionPaths);

  const cdp = await context.newCDPSession(page);
  if (args.geolocation) {
    await cdp.send('Emulation.setGeolocationOverride', {
      latitude: args.geolocation.latitude,
      longitude: args.geolocation.longitude,
      accuracy: args.geolocation.accuracy,
    });
  }
  // Native window at logical W×H + device metrics (no fullscreen — that left
  // mobile cssLayoutViewport stuck at the legacy ~980px width).
  await applyLogicalViewport(cdp, args.width, args.height, args.device, context);
  if (args.displayEnv) {
    await ensureChromeXFocus(args.displayEnv);
  }

  return { context, page, cdp, userDataDir };
}

/** Best-effort: raise Chrome so OS CorePointer/CoreKeyboard events hit the window. */
export async function ensureChromeXFocus(displayEnv: string): Promise<void> {
  const env = { ...process.env as Record<string, string>, DISPLAY: displayEnv };
  const classes = ['Google-chrome', 'google-chrome', 'Chromium', 'chromium'];
  for (const cls of classes) {
    try {
      await execFileAsync(
        'xdotool',
        ['search', '--onlyvisible', '--class', cls, 'windowactivate', '--sync'],
        { env, timeout: 2_000 },
      );
      return;
    } catch {
      /* try next class */
    }
  }
}

export async function closeChrome(
  handle: ChromeHandle,
  options?: { removeUserDataDir?: boolean },
): Promise<void> {
  try {
    await handle.context.close();
  } catch {
    /* best-effort */
  }
  if (options?.removeUserDataDir === false) return;
  try {
    fs.rmSync(handle.userDataDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/** Inject script tags into HTML at a fixed head-start point (legacy video/Patchright path).
 * Position was removed from the script DTO — PP uses CDP inline, not this helper. */
export function injectScriptTags(html: string, scripts: readonly BrowserScriptInjection[]): string {
  if (scripts.length === 0) return html;
  const tag = (s: BrowserScriptInjection): string => {
    const typeAttr = s.type === 'Module' ? ' type="module"' : '';
    const raw = s.remoteUrl && s.remoteUrl.length > 0 ? s.remoteUrl : s.file;
    const src = escapeHtmlAttr(raw);
    return `<script${typeAttr} src="${src}"></script>`;
  };
  const tags = scripts.map(tag).join('');
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + tags);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${tags}</head>`);
  }
  return `<head>${tags}</head>${html}`;
}
