import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type BrowserContext, type Page, type CDPSession } from 'patchright';
import type { BrowserDeviceProfile, BrowserScriptInjection } from '../BrowserSession';
import { applyDeviceEmulation, normalizeDevice } from './device-emulation';

const CHROME_EXECUTABLE = process.env['CHROME_EXECUTABLE'] ?? '/usr/bin/google-chrome';

export interface ChromeHandle {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  userDataDir: string;
}

export function profileDirForSession(sessionId: string): string {
  return path.join(os.tmpdir(), 'speculum-profiles', sessionId);
}

function buildChromeArgs(width: number, height: number): string[] {
  const args = [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${width},${height}`,
    '--window-position=0,0',
    '--disable-features=ExclusiveAccessBubble',
    '--no-first-run',
    '--mute-audio',
  ];

  if (process.env['SPECULUM_GL_FALLBACK'] === '1') {
    const extensionPath = path.resolve(__dirname, '../../../../sidecar/extensions/webgl-spoof');
    args.push('--use-gl=swiftshader');
    if (fs.existsSync(extensionPath)) {
      args.push(`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`);
    }
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
  device?: BrowserDeviceProfile;
  preserveUserDataDir?: boolean;
}): Promise<ChromeHandle> {
  const device = normalizeDevice(args.device);
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
    executablePath: CHROME_EXECUTABLE,
    env: {
      ...process.env as Record<string, string>,
      DISPLAY: args.displayEnv,
    },
    args: buildChromeArgs(args.width, args.height),
    viewport: null,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'dark',
  });

  let page = context.pages()[0];
  if (!page) page = await context.newPage();

  const cdp = await context.newCDPSession(page);
  const { windowId } = (await cdp.send('Browser.getWindowForTarget', {})) as { windowId: number };
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: { windowState: 'fullscreen' },
  });

  if (args.device) {
    await applyDeviceEmulation(cdp, args.width, args.height, device);
  }
  // No device profile: rely on window-size + fullscreen only (no Emulation override).

  return { context, page, cdp, userDataDir };
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
    return `<script${typeAttr} src="${s.file}"></script>`;
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
