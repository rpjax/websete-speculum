"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditableFocus = void 0;
/**
 * Polls editable focus and pushes onEditableFocusChanged (null = blur).
 */
class EditableFocus {
    events;
    timer = null;
    lastKey = '';
    page = null;
    constructor(events) {
        this.events = events;
    }
    start(page, intervalMs = 400) {
        this.page = page;
        this.stop();
        this.timer = setInterval(() => {
            void this.tick();
        }, intervalMs);
    }
    rebind(page) {
        this.page = page;
        this.lastKey = '';
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.timer = null;
    }
    async tick() {
        if (!this.page)
            return;
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
      })()`));
            const key = sample?.key ?? '';
            if (key === this.lastKey)
                return;
            this.lastKey = key;
            this.events.onEditableFocusChanged(sample?.editing ?? null);
        }
        catch {
            /* page gone */
        }
    }
}
exports.EditableFocus = EditableFocus;
//# sourceMappingURL=EditableFocus.js.map