"use strict";
/**
 * PROP_SET propId table — frame-protocol.md §4.4.
 * Decoder accepts 0x01–0x0A. Lab emit/materialize is VALUE/CHECKED/SELECTED only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROP_ID_CUSTOM_VALIDITY = exports.PROP_ID_MEDIA_VOLUME = exports.PROP_ID_MEDIA_MUTED = exports.PROP_ID_MEDIA_TIME = exports.PROP_ID_MEDIA_PAUSED = exports.PROP_ID_POPOVER_OPEN = exports.PROP_ID_DIALOG_MODAL = exports.PROP_ID_SELECTED = exports.PROP_ID_CHECKED = exports.PROP_ID_VALUE = void 0;
exports.propValueKind = propValueKind;
exports.propScalarsEqual = propScalarsEqual;
exports.PROP_ID_VALUE = 0x01;
exports.PROP_ID_CHECKED = 0x02;
exports.PROP_ID_SELECTED = 0x03;
exports.PROP_ID_DIALOG_MODAL = 0x04;
exports.PROP_ID_POPOVER_OPEN = 0x05;
exports.PROP_ID_MEDIA_PAUSED = 0x06;
exports.PROP_ID_MEDIA_TIME = 0x07;
exports.PROP_ID_MEDIA_MUTED = 0x08;
exports.PROP_ID_MEDIA_VOLUME = 0x09;
exports.PROP_ID_CUSTOM_VALIDITY = 0x0a;
function propValueKind(propId) {
    switch (propId) {
        case exports.PROP_ID_VALUE:
        case exports.PROP_ID_CUSTOM_VALIDITY:
            return 'str';
        case exports.PROP_ID_CHECKED:
        case exports.PROP_ID_SELECTED:
        case exports.PROP_ID_DIALOG_MODAL:
        case exports.PROP_ID_POPOVER_OPEN:
        case exports.PROP_ID_MEDIA_PAUSED:
        case exports.PROP_ID_MEDIA_MUTED:
            return 'bool';
        case exports.PROP_ID_MEDIA_TIME:
        case exports.PROP_ID_MEDIA_VOLUME:
            return 'f32';
        default:
            return null;
    }
}
function propScalarsEqual(a, b) {
    return a === b;
}
//# sourceMappingURL=propSet.js.map