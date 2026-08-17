/**
 * CSSOM identity maps — WeakMaps on live CSSStyleSheet / CSSRule objects.
 * Numbers come from the session allocator (frame-protocol.md §1.1 / §1.2): one monotonic
 * space with DOM, starting at 2. Ids survive replaceSync of *content* only if the sheet
 * object is the same; new rule objects get new ids (list-diff, not SHEET_DROP).
 */

/** Mint the next session id. Shared with {@link DomNodeTable.mint}. */
export type SessionIdMint = () => number;

const ID_SPACE_MAX = 0xffffffff;

function standaloneMintState(): { next: number } {
  return { next: 2 };
}

export class CssomIds {
  private readonly mint: SessionIdMint;
  private readonly sheets = new WeakMap<object, number>();
  private readonly rules = new WeakMap<object, number>();

  constructor(mint?: SessionIdMint) {
    if (mint !== undefined) {
      this.mint = mint;
      return;
    }
    const state = standaloneMintState();
    this.mint = () => {
      if (state.next > ID_SPACE_MAX) throw new Error('CssomIds: id space exhausted');
      const id = state.next;
      state.next += 1;
      return id;
    };
  }

  idOfSheet(sheet: object): number {
    const existing = this.sheets.get(sheet);
    if (existing !== undefined) return existing;
    const id = this.mint();
    this.sheets.set(sheet, id);
    return id;
  }

  idOfRule(rule: object): number {
    const existing = this.rules.get(rule);
    if (existing !== undefined) return existing;
    const id = this.mint();
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
}
