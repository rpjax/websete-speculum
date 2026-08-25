"use strict";
/**
 * Keyboard peripheral (§10.3 / D-UI-12).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyboardPeripheral = void 0;
class KeyboardPeripheral {
    writer;
    constructor(writer) {
        this.writer = writer;
    }
    key(code, down, modifiers) {
        this.writer.writeKey(code, down, modifiers);
    }
    sanitize() {
        this.writer.releaseAll();
    }
}
exports.KeyboardPeripheral = KeyboardPeripheral;
//# sourceMappingURL=KeyboardPeripheral.js.map