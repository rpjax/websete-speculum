/**
 * Patchright Chromium for Virtual — injects real virtual.js + config pre-script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'patchright';
import { buildConfigPreScript } from '../inject/buildConfigPreScript';
import { loadInpageScript } from '../inject/loadInpageScript';
import { LAB_TELEMETRY_DEFAULTS, type ProjectionTelemetryConfig } from '../models/telemetry';

export type LaunchVirtualBrowserOptions = {
  dataPlaneUrl: string;
  startUrl: string;
  headless: boolean;
  frameRateHz?: number;
  telemetry?: Record<string, unknown>;
};

export type VirtualBrowserHandle = {
  navigate(url: string): Promise<void>;
  close(): Promise<void>;
  readonly page: Page;
};

function chromeArgs(): string[] {
  // Parent §5.3.4 — background timer throttling must be off for Virtual.
  return [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

export async function launchVirtualBrowser(
  opts: LaunchVirtualBrowserOptions,
): Promise<VirtualBrowserHandle> {
  // Ensure bundle exists (clear message if build:virtual was skipped).
  loadInpageScript();
  const configPre = buildConfigPreScript({
    transport: 'loopback',
    dataPlaneUrl: opts.dataPlaneUrl,
    frameRateHz: opts.frameRateHz ?? 60,
    telemetry: (opts.telemetry ?? LAB_TELEMETRY_DEFAULTS) as Partial<ProjectionTelemetryConfig>,
  });
  const mainScript = loadInpageScript();

  const browser: Browser = await chromium.launch({
    headless: opts.headless,
    args: chromeArgs(),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  await page.addInitScript({ content: configPre });
  await page.addInitScript({ content: mainScript });

  await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  return {
    page,
    async navigate(url: string): Promise<void> {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}

/** Resolve lab static / fixture roots for both ts-node and compiled dist layouts. */
export function labAssetRoots(): { staticDir: string; fixturesDir: string } {
  const candidates = [
    path.join(__dirname, 'static'),
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static'),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'lab', 'static'),
  ];
  const staticDir =
    candidates.find((p) => fs.existsSync(p)) ??
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static');
  return {
    staticDir,
    fixturesDir: path.join(staticDir, 'fixtures'),
  };
}
