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
            this.timer = null;
        }
    }
    async tick() {
        if (!this.page)
            return;
        try {
            const editing = (await this.page.evaluate(`(() => {
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
        return {
          inputMode: el.getAttribute('inputmode') || undefined,
          multiline: tag === 'textarea' || !!el.isContentEditable,
          tagName: tag,
        };
      })()`));
            const key = editing
                ? `${editing.tagName}|${editing.inputMode}|${editing.multiline}`
                : '';
            if (key === this.lastKey)
                return;
            this.lastKey = key;
            this.events.onEditableFocusChanged(editing);
        }
        catch {
            /* page gone */
        }
    }
}
exports.EditableFocus = EditableFocus;
//# sourceMappingURL=EditableFocus.js.map