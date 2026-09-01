import type { BrowserTouchPoint } from '../../BrowserSession';

/**
 * Injects already-admitted pointer/key/touch into the session browser.
 * Implementations must be safe to call from InputController's serialized chain.
 */
export interface InputBackend {
  move(x: number, y: number): Promise<void>;
  down(button: number, x: number, y: number): Promise<void>;
  up(button: number, x: number, y: number): Promise<void>;
  wheel(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  keyDown(key: string): Promise<void>;
  keyUp(key: string): Promise<void>;
  typeText(text: string): Promise<void>;
  touch(phase: string, points: readonly BrowserTouchPoint[]): Promise<void>;
  dispose(): Promise<void>;
}
