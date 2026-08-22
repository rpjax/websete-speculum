"use strict";
/**
 * PROP_SET propId table — frame-protocol.md §4.4 (shipped ISA lacre).
 * Only VALUE / CHECKED / SELECTED. Any other propId is malformed on the wire.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROP_ID_SELECTED = exports.PROP_ID_CHECKED = exports.PROP_ID_VALUE = void 0;
exports.propValueKind = propValueKind;
exports.propScalarsEqual = propScalarsEqual;
exports.PROP_ID_VALUE = 0x01;
exports.PROP_ID_CHECKED = 0x02;
exports.PROP_ID_SELECTED = 0x03;
function propValueKind(propId) {
    switch (propId) {
        case exports.PROP_ID_VALUE:
            return 'str';
        case exports.PROP_ID_CHECKED:
        case exports.PROP_ID_SELECTED:
            return 'bool';
        default:
            return null;
    }
}
function propScalarsEqual(a, b) {
    return a === b;
}
//# sourceMappingURL=propSet.js.map