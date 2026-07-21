"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaIngress = void 0;
/**
 * Camera/mic ingress — TODO: v4l2loopback per session + Chrome getUserMedia binding.
 * Until then, push paths fail closed (no fake file append).
 * Permission events remain on BrowserSessionEvents for when GUM is wired.
 */
class MediaIngress {
    events;
    constructor(_sessionId, events) {
        this.events = events;
        void this.events;
    }
    async pushCameraFrame(_frame) {
        throw Object.assign(new Error('media_ingress_not_implemented'), {
            code: 'FAILED_PRECONDITION',
        });
    }
    async pushMicrophoneAudio(_chunk) {
        throw Object.assign(new Error('media_ingress_not_implemented'), {
            code: 'FAILED_PRECONDITION',
        });
    }
    async dispose() {
        /* nothing to clean until v4l2 path exists */
    }
}
exports.MediaIngress = MediaIngress;
//# sourceMappingURL=MediaIngress.js.map