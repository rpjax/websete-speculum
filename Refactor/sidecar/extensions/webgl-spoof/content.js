/**
 * WebGL vendor/renderer fallback (MAIN world, document_start).
 * Session kit init script is the source of truth and re-applies per category;
 * this extension stays aligned with the Linux pc kit so it never claims D3D11/Windows.
 */
(function () {
    'use strict';

    const VENDOR = 'Google Inc. (Intel)';
    const RENDERER =
        'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (CFL GT2), OpenGL 4.5)';

    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;

    function patchContext(proto) {
        const origGetParam = proto.getParameter;
        const origGetExt = proto.getExtension;

        Object.defineProperty(proto, 'getParameter', {
            value: function (param) {
                switch (param) {
                    case UNMASKED_VENDOR_WEBGL: return VENDOR;
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
