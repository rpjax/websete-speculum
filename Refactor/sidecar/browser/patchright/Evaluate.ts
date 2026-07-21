import type { ConsoleMessage, Page } from 'patchright';
import type { BrowserEvalResult, BrowserSessionEvents } from '../BrowserSession';

const LEVEL: Record<string, number> = {
  log: 0,
  warning: 1,
  warn: 1,
  error: 2,
  assert: 2,
  info: 3,
  debug: 4,
  dir: 0,
  dirxml: 0,
  table: 0,
  trace: 4,
  clear: 0,
  startGroup: 0,
  startGroupCollapsed: 0,
  endGroup: 0,
  count: 3,
  timeEnd: 3,
};

/**
 * Evaluate via Patchright page.evaluate (no Runtime.enable).
 * Console via page.on('console') — no CDP Runtime domain.
 */
export class Evaluate {
  private handler: ((msg: ConsoleMessage) => void) | null = null;
  private page: Page | null = null;

  constructor(private readonly events: BrowserSessionEvents) {}

  attachConsole(page: Page): void {
    if (this.page && this.handler) {
      this.page.off('console', this.handler);
    }
    this.page = page;
    this.handler = (msg: ConsoleMessage) => {
      const level = LEVEL[msg.type()] ?? 0;
      let text = msg.text();
      if (text.length > 65_536) text = text.slice(0, 65_536) + ' … [truncated]';
      this.events.onConsole(level, text);
    };
    page.on('console', this.handler);
  }

  async run(page: Page, code: string): Promise<BrowserEvalResult> {
    try {
      const value = await page.evaluate(
        `(async function(){try{` +
          `var __r=(0,eval)(${JSON.stringify(code)});` +
          `if(__r&&typeof __r.then==='function')__r=await __r;` +
          `return{ok:true,v:__r===undefined?null:` +
          `(function(){try{return JSON.stringify(__r)}catch(_){return String(__r)}})()}` +
          `}catch(e){return{ok:false,v:e.message||String(e)}}})()`,
      );
      const r = value as { ok: boolean; v: string | null };
      if (!r.ok) return { ok: false, value: '', errorMessage: r.v ?? 'Evaluation error' };
      return { ok: true, value: r.v ?? '' };
    } catch (err) {
      return { ok: false, value: '', errorMessage: (err as Error).message };
    }
  }
}
