import type { BrowserDeviceProfile } from '../BrowserSession';

/** Confirmed Motor viewport owner for a session. */
export class Viewport {
  private _width: number;
  private _height: number;
  private _device: BrowserDeviceProfile | null;
  private _resizing = false;

  constructor(width: number, height: number, device?: BrowserDeviceProfile) {
    this._width = width;
    this._height = height;
    this._device = device ?? null;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get device(): BrowserDeviceProfile | null {
    return this._device;
  }

  get isResizing(): boolean {
    return this._resizing;
  }

  setResizing(value: boolean): void {
    this._resizing = value;
  }

  confirm(width: number, height: number, device?: BrowserDeviceProfile): void {
    this._width = width;
    this._height = height;
    if (device !== undefined) {
      this._device = device;
    }
  }
}
