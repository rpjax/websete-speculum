"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoMirror = void 0;
const Screencast_1 = require("../../Screencast");
/**
 * Thin Video Streaming mirror facade — only constructed when MirrorMode is VideoStreaming.
 */
class VideoMirror {
    screencast;
    onFrame = null;
    constructor(screencast) {
        this.screencast = screencast;
    }
    static async start(cdp, encodeWidth, encodeHeight, onFrame, cssWidth, cssHeight) {
        const screencast = await Screencast_1.Screencast.start(cdp, encodeWidth, encodeHeight, onFrame, cssWidth, cssHeight);
        const mirror = new VideoMirror(screencast);
        mirror.onFrame = onFrame;
        return mirror;
    }
    async restart(encodeWidth, encodeHeight, cssWidth, cssHeight, cdp) {
        if (!this.onFrame)
            return;
        await this.screencast.restart(encodeWidth, encodeHeight, this.onFrame, cdp, cssWidth, cssHeight);
    }
    async stop() {
        await this.screencast.stop();
    }
    get underlying() {
        return this.screencast;
    }
}
exports.VideoMirror = VideoMirror;
//# sourceMappingURL=VideoMirror.js.map