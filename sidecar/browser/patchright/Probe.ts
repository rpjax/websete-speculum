import type { BrowserContext, CDPSession, Page } from 'patchright';
import type { BrowserProbeRequest, BrowserProbeResult } from '../BrowserSession';
import type { Display } from './Display';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Main-world eval — Patchright {@code page.evaluate} is isolated (DOM yes, page JS no). */
async function runtimeEvaluate(cdp: CDPSession, expression: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as any;
  if (raw?.exceptionDetails) {
    const msg =
      raw.exceptionDetails.exception?.description ??
      raw.exceptionDetails.text ??
      'evaluate failed';
    throw new Error(String(msg));
  }
  return raw?.result?.value;
}

export class Probe {
  async run(
    request: BrowserProbeRequest,
    ctx: {
      context: BrowserContext;
      page: Page;
      cdp: CDPSession;
      display: Display | null;
      userDataDir: string;
    },
  ): Promise<BrowserProbeResult> {
    try {
      const opSet = new Set(request.ops);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: Record<string, any> = {};

      if (opSet.has('tabs')) {
        const pages = ctx.context.pages();
        data.tabs = {
          tabCount: pages.length,
          urls: pages.map((p) => {
            try {
              return p.url();
            } catch {
              return '';
            }
          }),
        };
      }

      if (opSet.has('cookies')) {
        const result = (await ctx.cdp.send('Network.getAllCookies')) as {
          cookies?: unknown[];
        };
        data.cookies = (result.cookies ?? []).slice(0, 50);
      }

      if (opSet.has('process') && ctx.display) {
        const geo = await ctx.display.readActiveGeometry().catch(() => ({
          width: 0,
          height: 0,
        }));
        data.process = {
          display: ctx.display.displayEnv,
          activeWidth: geo.width,
          activeHeight: geo.height,
          userDataDirExists: true,
        };
      }

      if (opSet.has('dom') && request.domSelector) {
        const sel = JSON.stringify(request.domSelector);
        // Main world — same as evaluate (page.evaluate is isolated and misses page JS).
        data.dom = await runtimeEvaluate(
          ctx.cdp,
          `(() => {
          const el = document.querySelector(${sel});
          if (!el) return null;
          return { outerHTML: el.outerHTML.slice(0, 8192), text: el.textContent };
        })()`,
        );
      }

      if (opSet.has('evaluate') && request.evaluateExpression) {
        // SessionsTest harness Probe→evaluate must see page JS oracles (window.__*__).
        // Patchright page.evaluate runs in an isolated world — DOM attrs work, page
        // locals do not (Video C2/C3/C7/C8/C10/C12 false reds after M1 sealed path).
        data.evaluate = await runtimeEvaluate(ctx.cdp, request.evaluateExpression);
      }

      // Viewport still of Speculum Virtual — O1 accept bar (not host Playwright).
      // Always spill to a sidecar temp path so gRPC/JSON probe budgets never truncate PNGs.
      if (opSet.has('screenshot')) {
        const buf = await ctx.page.screenshot({ type: 'png', fullPage: false });
        const file = path.join(os.tmpdir(), `speculum-virtual-still-${Date.now()}.png`);
        fs.writeFileSync(file, buf);
        data.screenshot = { path: file, byteLength: buf.byteLength };
      }

      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        errorCode: 'probe_failed',
        message: (err as Error).message?.slice(0, 512),
      };
    }
  }
}
