"use strict";
/**
 * ABS-only pointer peripheral (§10.3).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbsPointerPeripheral = void 0;
class AbsPointerPeripheral {
    writer;
    constructor(writer) {
        this.writer = writer;
    }
    moveTo(x, y) {
        this.writer.writeAbs(x, y);
    }
    button(btn, down) {
        this.writer.writeBtn(btn, down);
    }
    sanitize() {
        this.writer.releaseAll();
    }
}
exports.AbsPointerPeripheral = AbsPointerPeripheral;
//# sourceMappingURL=AbsPointerPeripheral.js.map