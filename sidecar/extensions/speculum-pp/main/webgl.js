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
        if (!proto.__speculumWebglOrigGetParam) {
            Object.defineProperty(proto, '__speculumWebglOrigGetParam', {
                value: proto.getParameter,
                configurable: true,
            });
            Object.defineProperty(proto, '__speculumWebglOrigGetExt', {
                value: proto.getExtension,
                configurable: true,
            });
        }
        const origGetParam = proto.__speculumWebglOrigGetParam;
        const origGetExt = proto.__speculumWebglOrigGetExt;

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

    patchContext(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') {
        patchContext(WebGL2RenderingContext.prototype);
    }
})();
