import type { CDPSession, Page } from 'patchright';
import type { BrowserEvalResult, BrowserSessionEvents } from '../BrowserSession';
import { attachCdpConsoleRelay } from './cdpConsoleRelay';

/**
 * Evaluate via Patchright page.evaluate.
 * Console relay via CDP Runtime (Patchright `page.on('console')` is silent).
 */
export class Evaluate {
  private page: Page | null = null;
  private cdp: CDPSession | null = null;

  constructor(private readonly events: BrowserSessionEvents) {}

  async attachConsole(page: Page, cdp: CDPSession): Promise<void> {
    this.page = page;
    this.cdp = cdp;
    await attachCdpConsoleRelay(cdp, (level, text) => this.events.onConsole(level, text));
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
