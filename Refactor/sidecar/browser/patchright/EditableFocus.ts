import type { Page } from 'patchright';
import type { BrowserEditingState, BrowserSessionEvents } from '../BrowserSession';

type FocusSample = {
  editing: BrowserEditingState;
  /** Local change key — not on the wire. Distinguishes focus targets. */
  key: string;
};

/**
 * Polls editable focus and pushes onEditableFocusChanged (null = blur).
 */
export class EditableFocus {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastKey = '';
  private page: Page | null = null;

  constructor(private readonly events: BrowserSessionEvents) {}

  start(page: Page, intervalMs = 400): void {
    this.page = page;
    this.stop();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  rebind(page: Page): void {
    this.page = page;
    this.lastKey = '';
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!this.page) return;
    try {
      // Expando id on the DOM node — stable across polls; getBoundingClientRect
      // alone re-fires on scroll/keyboard resize and spams EditableFocus.
      const sample = (await this.page.evaluate(`(() => {
        function resolveActive(doc) {
          const el = doc.activeElement;
          if (!el) return null;
          if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
            try {
              const child = el.contentDocument;
              if (child) return resolveActive(child);
            } catch {}
            return null;
          }
          return el;
        }
        const el = resolveActive(document);
        if (!el) return null;
        const tag = el.tagName.toLowerCase();
        const TEXT_INPUT_TYPES = new Set([
          '', 'text', 'search', 'email', 'tel', 'url', 'password', 'number',
          'date', 'datetime-local', 'month', 'time', 'week',
        ]);
        const isEditable =
          el.isContentEditable ||
          tag === 'textarea' ||
          (tag === 'input' && TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase()));
        if (!isEditable) return null;
        const inputMode = el.getAttribute('inputmode') || undefined;
        const multiline = tag === 'textarea' || !!el.isContentEditable;
        if (!el.__speculumFocusId) {
          el.__speculumFocusId = 'f' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
        return {
          editing: { inputMode, multiline, tagName: tag },
          key: el.__speculumFocusId,
        };
      })()`)) as FocusSample | null;

      const key = sample?.key ?? '';
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.events.onEditableFocusChanged(sample?.editing ?? null);
    } catch {
      /* page gone */
    }
  }
}
