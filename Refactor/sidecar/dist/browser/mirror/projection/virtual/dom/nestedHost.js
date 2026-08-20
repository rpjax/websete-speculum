"use strict";
/**
 * Nested browsing-context host — classify with `contentWindow != null`, not `.contentDocument`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNestedHostNavAttr = void 0;
exports.isNestedBrowsingHost = isNestedBrowsingHost;
var nestedNav_1 = require("../../models/nestedNav");
Object.defineProperty(exports, "isNestedHostNavAttr", { enumerable: true, get: function () { return nestedNav_1.isNestedHostNavAttr; } });
function isNestedBrowsingHost(node) {
    if (node.nodeType !== 1)
        return false;
    if (!node.isConnected)
        return false;
    const cw = node.contentWindow;
    return cw != null;
}
//# sourceMappingURL=nestedHost.js.map