"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Viewport = void 0;
/** Confirmed Motor viewport owner for a session. */
class Viewport {
    _width;
    _height;
    _device;
    _resizing = false;
    constructor(width, height, device) {
        this._width = width;
        this._height = height;
        this._device = device ?? null;
    }
    get width() {
        return this._width;
    }
    get height() {
        return this._height;
    }
    get device() {
        return this._device;
    }
    get isResizing() {
        return this._resizing;
    }
    setResizing(value) {
        this._resizing = value;
    }
    confirm(width, height, device) {
        this._width = width;
        this._height = height;
        if (device !== undefined) {
            this._device = device;
        }
    }
}
exports.Viewport = Viewport;
//# sourceMappingURL=Viewport.js.map