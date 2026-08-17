/**
 * CSSOM id allocator — D-SPEC-8 range `[0x80000001 .. 0xFFFFFFFF]`. WeakMaps on live
 * CSSStyleSheet / CSSRule objects. Ids survive replaceSync of *content* only if the sheet
 * object is the same; new rule objects get new ids (list-diff, not SHEET_DROP).
 */

export const CSSOM_ID_MIN = 0x80000001;
export const CSSOM_ID_MAX = 0xffffffff;

export class CssomIds {
  private next = CSSOM_ID_MIN;
  private readonly sheets = new WeakMap<object, number>();
  private readonly rules = new WeakMap<object, number>();

  idOfSheet(sheet: object): number {
    const existing = this.sheets.get(sheet);
    if (existing !== undefined) return existing;
    const id = this.alloc();
    this.sheets.set(sheet, id);
    return id;
  }

  idOfRule(rule: object): number {
    const existing = this.rules.get(rule);
    if (existing !== undefined) return existing;
    const id = this.alloc();
    this.rules.set(rule, id);
    return id;
  }

  peekSheet(sheet: object): number | undefined {
    return this.sheets.get(sheet);
  }

  peekRule(rule: object): number | undefined {
    return this.rules.get(rule);
  }

  /** Drop+new of a still-live object (grouping rule content change) — next `idOfRule` allocates. */
  forgetRule(rule: object): void {
    this.rules.delete(rule);
  }

  private alloc(): number {
    if (this.next > CSSOM_ID_MAX) throw new Error('CssomIds: id space exhausted');
    const id = this.next;
    this.next += 1;
    return id;
  }
}
