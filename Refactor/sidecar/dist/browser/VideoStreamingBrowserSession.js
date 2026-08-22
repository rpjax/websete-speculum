"use strict";
/**
 * VideoStreamingBrowserSession — sealed video mirror mode.
 * Lifts {@link PatchrightBrowserSession} (Xvfb + screencast + OS/Patchright input).
 * PageProjection must not use this class.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVideoStreamingBrowserSessionFactory = exports.VideoStreamingBrowserSession = void 0;
const PatchrightBrowserSession_1 = require("./patchright/PatchrightBrowserSession");
class VideoStreamingBrowserSession extends PatchrightBrowserSession_1.PatchrightBrowserSession {
    constructor(sessionId, events, displays) {
        super(sessionId, events, displays);
    }
}
exports.VideoStreamingBrowserSession = VideoStreamingBrowserSession;
var createPatchrightFactory_1 = require("./patchright/createPatchrightFactory");
Object.defineProperty(exports, "createVideoStreamingBrowserSessionFactory", { enumerable: true, get: function () { return createPatchrightFactory_1.createPatchrightFactory; } });
//# sourceMappingURL=VideoStreamingBrowserSession.js.map