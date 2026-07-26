/**
 * Minimal typed event bus (no DOM dependency beyond EventTarget).
 */
export class Emitter extends EventTarget {
  /**
   * @param {string} type
   * @param {(event: CustomEvent) => void} listener
   * @returns {() => void} disposer
   */
  on(type, listener) {
    /** @param {Event} event */
    const wrapped = (event) => listener(/** @type {CustomEvent} */ (event))
    this.addEventListener(type, wrapped)
    return () => this.removeEventListener(type, wrapped)
  }

  /**
   * @param {string} type
   * @param {unknown} [detail]
   */
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}
