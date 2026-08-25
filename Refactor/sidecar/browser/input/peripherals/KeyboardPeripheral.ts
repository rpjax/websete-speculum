/**
 * Keyboard peripheral (§10.3 / D-UI-12).
 */

export interface IKeyboardPeripheral {
  key(code: string, down: boolean, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): void;
  sanitize(): void;
}

export type KeyboardWriter = {
  writeKey(code: string, down: boolean, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): void;
  releaseAll(): void;
};

export class KeyboardPeripheral implements IKeyboardPeripheral {
  constructor(private readonly writer: KeyboardWriter) {}

  key(
    code: string,
    down: boolean,
    modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean },
  ): void {
    this.writer.writeKey(code, down, modifiers);
  }

  sanitize(): void {
    this.writer.releaseAll();
  }
}
