"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPatchrightFactory = createPatchrightFactory;
const Display_1 = require("./Display");
const PatchrightBrowserSession_1 = require("./PatchrightBrowserSession");
function createPatchrightFactory(displays = new Display_1.DisplayAllocator()) {
    return {
        create(sessionId, events) {
            return new PatchrightBrowserSession_1.PatchrightBrowserSession(sessionId, events, displays);
        },
    };
}
//# sourceMappingURL=createPatchrightFactory.js.map