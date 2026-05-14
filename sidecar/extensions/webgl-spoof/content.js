/**
 * WebGL vendor/renderer spoof — runs in MAIN world at document_start,
 * before any page script executes.
 *
 * Patches both WebGL1 and WebGL2 contexts to report an Intel integrated
 * GPU instead of Mesa/SwiftShader, which is strongly associated with
 * headless/automated Chrome.
 *
 * The UNMASKED_VENDOR/RENDERER values require the WEBGL_debug_renderer_info
 * extension, which we also patch to always appear available.
 */
(function () {
    'use strict';

    const VENDOR   = 'Google Inc. (Intel)';
    const RENDERER = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';

    // WEBGL_debug_renderer_info extension constants
    const UNMASKED_VENDOR_WEBGL   = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;

    function patchContext(proto) {
        const origGetParam = proto.getParameter;
        const origGetExt   = proto.getExtension;

        Object.defineProperty(proto, 'getParameter', {
            value: function (param) {
                switch (param) {
                    case UNMASKED_VENDOR_WEBGL:   return VENDOR;
                    case UNMASKED_RENDERER_WEBGL: return RENDERER;
                    default: return origGetParam.call(this, param);
                }
            },
            writable: true, configurable: true,
        });

        Object.defineProperty(proto, 'getExtension', {
            value: function (name) {
                const ext = origGetExt.call(this, name);
                if (name === 'WEBGL_debug_renderer_info') {
                    // Return a fake extension object with the correct constants.
                    return ext ?? {
                        UNMASKED_VENDOR_WEBGL,
                        UNMASKED_RENDERER_WEBGL,
                    };
                }
                return ext;
            },
            writable: true, configurable: true,
        });
    }

    patchContext(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') {
        patchContext(WebGL2RenderingContext.prototype);
    }
})();
