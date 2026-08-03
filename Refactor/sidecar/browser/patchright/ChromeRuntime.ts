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

/** Path to webgl-spoof from compiled `dist/browser/patchright` (and Docker `/app`). */
export function webglSpoofExtensionPath(): string {
  return path.resolve(__dirname, '../../../extensions/webgl-spoof');
}

/**
 * Chrome launch flags. WebGL spoof is always on (SwiftShader + extension), matching
 * the original motor — opt out only with SPECULUM_GL_FALLBACK=0 (lab escape).
 */
export function buildChromeArgs(width: number, height: number): string[] {
  const disableFeatures = ['ExclusiveAccessBubble'];
  const glEnabled = process.env['SPECULUM_GL_FALLBACK'] !== '0';
  if (glEnabled) {
    // Chrome ≥137 may ignore --load-extension unless this feature is disabled.
    disableFeatures.push('DisableLoadExtensionCommandLineSwitch');
  }

  const args = [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${width},${height}`,
    '--window-position=0,0',
    `--disable-features=${disableFeatures.join(',')}`,
    '--touch-events=enabled',
    '--no-first-run',
    '--mute-audio',
  ];

  if (glEnabled) {
    const extensionPath = webglSpoofExtensionPath();
    if (!fs.existsSync(extensionPath)) {
      throw Object.assign(
        new Error(`webgl-spoof extension missing at ${extensionPath}`),
        { code: 'FAILED_PRECONDITION', errorCode: 'webgl_spoof_missing', phase: 'launch' },
      );
    }
    args.push(
      '--use-gl=swiftshader',
      `--load-extension=${extensionPath}`,
      `--disable-extensions-except=${extensionPath}`,
    );
  }

  if (process.env['SPECULUM_IGNORE_CERT_ERRORS'] === '1') {
    args.push('--ignore-certificate-errors');
  }

  return args;
}

export async function launchChrome(args: {
  sessionId: string;
  displayEnv: string;
  width: number;
  height: number;
  locale: string;
  language: string;
  timeZoneId: string;
  colorScheme: BrowserColorScheme;
  geolocation?: BrowserGeolocation;
  device?: BrowserDeviceProfile;
  preserveUserDataDir?: boolean;
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

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: chromeExecutable,
    env: {
      ...process.env as Record<string, string>,
      DISPLAY: args.displayEnv,
    },
    args: buildChromeArgs(args.width, args.height),
    viewport: null,
    locale: args.locale,
    timezoneId: args.timeZoneId,
    colorScheme: args.colorScheme,
    extraHTTPHeaders: {
      'Accept-Language': args.language,
    },
  });

  let page = context.pages()[0];
  if (!page) page = await context.newPage();

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
  await applyLogicalViewport(cdp, args.width, args.height, args.device);
  await ensureChromeXFocus(args.displayEnv);

  return { context, page, cdp, userDataDir };
}

/** Best-effort: raise Chrome so OS CorePointer/CoreKeyboard events hit the window. */
async function ensureChromeXFocus(displayEnv: string): Promise<void> {
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

/** Inject script tags into HTML by position (used by Navigation fetch fulfill). */
export function injectScriptTags(html: string, scripts: readonly BrowserScriptInjection[]): string {
  const groups: Record<string, BrowserScriptInjection[]> = {
    HeaderTop: [],
    HeaderBottom: [],
    BodyTop: [],
    BodyBottom: [],
  };
  for (const s of scripts) {
    if (s.position in groups) groups[s.position].push(s);
  }
  const tag = (s: BrowserScriptInjection): string => {
    const typeAttr = s.type === 'Module' ? ' type="module"' : '';
    const raw = s.remoteUrl && s.remoteUrl.length > 0 ? s.remoteUrl : s.file;
    const src = escapeHtmlAttr(raw);
    return `<script${typeAttr} src="${src}"></script>`;
  };
  let out = html;
  if (groups.HeaderTop.length) {
    out = out.replace(/<head[^>]*>/i, (m) => m + groups.HeaderTop.map(tag).join(''));
  }
  if (groups.HeaderBottom.length) {
    out = out.replace(/<\/head>/i, groups.HeaderBottom.map(tag).join('') + '</head>');
  }
  if (groups.BodyTop.length) {
    out = out.replace(/<body[^>]*>/i, (m) => m + groups.BodyTop.map(tag).join(''));
  }
  if (groups.BodyBottom.length) {
    out = out.replace(/<\/body>/i, groups.BodyBottom.map(tag).join('') + '</body>');
  }
  return out;
}
