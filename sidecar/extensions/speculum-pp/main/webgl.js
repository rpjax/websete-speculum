/**
 * WebGL identity fallback (MAIN world, document_start) — pc kit literals.
 * Session init script is the source of truth per device category and re-applies
 * VENDOR / RENDERER / UNMASKED on WebGL1+2.
 */
(function () {
    'use strict';

    const VENDOR = 'WebKit';
    const RENDERER = 'WebKit WebGL';
    const UNMASKED_VENDOR = 'Google Inc. (Intel)';
    const UNMASKED_RENDERER =
        'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (CFL GT2), OpenGL 4.5)';

    const GL_VENDOR = 0x1F00;
    const GL_RENDERER = 0x1F01;
    const UNMASKED_VENDOR_WEBGL = 0x9245;
    const UNMASKED_RENDERER_WEBGL = 0x9246;

    function patchContext(proto) {
        if (!proto) return;
        const origGetParam = proto.getParameter;
        const origGetExt = proto.getExtension;
        if (typeof origGetParam !== 'function' || typeof origGetExt !== 'function') return;

        Object.defineProperty(proto, 'getParameter', {
            value: function (param) {
                switch (param) {
                    case GL_VENDOR: return VENDOR;
                    case GL_RENDERER: return RENDERER;
                    case UNMASKED_VENDOR_WEBGL: return UNMASKED_VENDOR;
                    case UNMASKED_RENDERER_WEBGL: return UNMASKED_RENDERER;
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

    if (typeof WebGLRenderingContext !== 'undefined') {
        patchContext(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
        patchContext(WebGL2RenderingContext.prototype);
    }
})();
