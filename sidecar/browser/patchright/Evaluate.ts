import type { CDPSession, Page } from 'patchright';
import type { BrowserEvalResult, BrowserSessionEvents } from '../BrowserSession';
import { attachCdpConsoleRelay } from './cdpConsoleRelay';

/**
 * Evaluate in the page main world via CDP {@code Runtime.evaluate}.
 *
 * Patchright {@code page.evaluate} runs in an isolated utility world — DOM
 * attributes are visible there, but page JS state ({@code window.__*__} fixture
 * oracles) is not. SessionsTest Video C* oracles need main-world reads
 * (same contract as {@link PageProjectionBrowserSession.evaluate}).
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
    const cdp = this.cdp;
    try {
      if (cdp) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = (await cdp.send('Runtime.evaluate', {
            expression: code,
            returnByValue: true,
            awaitPromise: true,
          })) as any;
          if (raw?.exceptionDetails) {
            const msg =
              raw.exceptionDetails.exception?.description ??
              raw.exceptionDetails.text ??
              'evaluate failed';
            return { ok: false, value: '', errorMessage: String(msg) };
          }
          const value = raw?.result?.value;
          return {
            ok: true,
            value: typeof value === 'string' ? value : JSON.stringify(value ?? null),
          };
        } catch {
          /* fall back to Patchright evaluate */
        }
      }
      const value = await page.evaluate(code);
      return { ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) };
    } catch (err) {
      return { ok: false, value: '', errorMessage: (err as Error).message };
    }
  }
}
