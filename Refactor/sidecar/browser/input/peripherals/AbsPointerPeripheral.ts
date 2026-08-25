/**
 * ABS-only pointer peripheral (§10.3).
 */

export type PointerButton = 'left' | 'middle' | 'right';

export interface IAbsPointerPeripheral {
  moveTo(x: number, y: number): void;
  button(btn: PointerButton, down: boolean): void;
  sanitize(): void;
}

export type AbsPointerWriter = {
  writeAbs(x: number, y: number): void;
  writeBtn(btn: PointerButton, down: boolean): void;
  releaseAll(): void;
};

export class AbsPointerPeripheral implements IAbsPointerPeripheral {
  constructor(private readonly writer: AbsPointerWriter) {}

  moveTo(x: number, y: number): void {
    this.writer.writeAbs(x, y);
  }

  button(btn: PointerButton, down: boolean): void {
    this.writer.writeBtn(btn, down);
  }

  sanitize(): void {
    this.writer.releaseAll();
  }
}
