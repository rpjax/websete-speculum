"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_KITS = void 0;
exports.resolveDeviceCategory = resolveDeviceCategory;
exports.resolveDeviceKit = resolveDeviceKit;
exports.kitNavigatorSpoofSource = kitNavigatorSpoofSource;
exports.kitStealthInitSource = kitStealthInitSource;
exports.kitHardwareSpoofSource = kitHardwareSpoofSource;
const PHONE_KIT = {
    category: 'phone',
    navigatorPlatform: 'Linux armv8l',
    uaChPlatform: 'Android',
    uaChPlatformVersion: '13.0.0',
    uaChArchitecture: '',
    uaChBitness: '',
    uaChModel: 'Pixel 7',
    mobile: true,
    touch: true,
    minMaxTouchPoints: 5,
    hardwareConcurrency: 8,
    deviceMemory: 4,
    webglVendor: 'WebKit',
    webglRenderer: 'WebKit WebGL',
    webglUnmaskedVendor: 'Qualcomm',
    webglUnmaskedRenderer: 'ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)',
    buildUserAgent: (chromeVer) => `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) `
        + `Chrome/${chromeVer} Mobile Safari/537.36`,
};
const TABLET_KIT = {
    category: 'tablet',
    navigatorPlatform: 'Linux armv8l',
    uaChPlatform: 'Android',
    uaChPlatformVersion: '14.0.0',
    uaChArchitecture: '',
    uaChBitness: '',
    uaChModel: 'Pixel Tablet',
    mobile: true,
    touch: true,
    minMaxTouchPoints: 5,
    hardwareConcurrency: 8,
    deviceMemory: 4,
    webglVendor: 'WebKit',
    webglRenderer: 'WebKit WebGL',
    webglUnmaskedVendor: 'Qualcomm',
    webglUnmaskedRenderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
    buildUserAgent: (chromeVer) => `Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) `
        + `Chrome/${chromeVer} Safari/537.36`,
};
const PC_KIT = {
    category: 'pc',
    navigatorPlatform: 'Linux x86_64',
    uaChPlatform: 'Linux',
    uaChPlatformVersion: '6.5.0',
    uaChArchitecture: 'x86',
    uaChBitness: '64',
    uaChModel: '',
    mobile: false,
    touch: false,
    minMaxTouchPoints: 0,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'WebKit',
    webglRenderer: 'WebKit WebGL',
    webglUnmaskedVendor: 'Google Inc. (Intel)',
    webglUnmaskedRenderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (CFL GT2), OpenGL 4.5)',
    // Desktop uses Chrome's native UA from Browser.getVersion (Linux container).
    buildUserAgent: () => '',
};
exports.DEVICE_KITS = {
    phone: PHONE_KIT,
    tablet: TABLET_KIT,
    pc: PC_KIT,
};
/**
 * Resolve kit category from wire profile.
 * Accepts explicit deviceCategory, userAgentProfile aliases, or mobile flag.
 */
function resolveDeviceCategory(device) {
    const raw = (device?.deviceCategory ?? device?.userAgentProfile ?? '').trim().toLowerCase();
    if (raw === 'phone' || raw === 'mobile') {
        return 'phone';
    }
    if (raw === 'tablet') {
        return 'tablet';
    }
    if (raw === 'pc' || raw === 'desktop') {
        return 'pc';
    }
    return device?.mobile ? 'phone' : 'pc';
}
function resolveDeviceKit(device) {
    return exports.DEVICE_KITS[resolveDeviceCategory(device)];
}
function jsonString(value) {
    return JSON.stringify(value);
}
/**
 * Identity spoof for worker-like CDP targets (and safe Runtime.evaluate anywhere).
 * Navigator + WebGL getParameter (same kit literals as main). No Worker constructor wrap.
 */
function kitNavigatorSpoofSource(args) {
    const { kit, userAgent } = args;
    const cores = kit.hardwareConcurrency;
    const mem = kit.deviceMemory;
    const platform = jsonString(kit.navigatorPlatform);
    const ua = jsonString(userAgent);
    const uaChPlatform = jsonString(kit.uaChPlatform);
    const uaChMobile = kit.mobile ? 'true' : 'false';
    const maskedVendor = jsonString(kit.webglVendor);
    const maskedRenderer = jsonString(kit.webglRenderer);
    const unmaskedVendor = jsonString(kit.webglUnmaskedVendor);
    const unmaskedRenderer = jsonString(kit.webglUnmaskedRenderer);
    return `(() => {
  const cores = ${cores};
  const mem = ${mem};
  const platform = ${platform};
  const ua = ${ua};
  const uaChPlatform = ${uaChPlatform};
  const uaChMobile = ${uaChMobile};
  const webglVendor = ${maskedVendor};
  const webglRenderer = ${maskedRenderer};
  const webglUnmaskedVendor = ${unmaskedVendor};
  const webglUnmaskedRenderer = ${unmaskedRenderer};

  function spoof(nav) {
    if (!nav) return;
    try {
      Object.defineProperty(nav, 'hardwareConcurrency', {
        get: function () { return cores; },
        configurable: true,
      });
    } catch (_) {}
    try {
      Object.defineProperty(nav, 'deviceMemory', {
        get: function () { return mem; },
        configurable: true,
      });
    } catch (_) {}
    try {
      Object.defineProperty(nav, 'platform', {
        get: function () { return platform; },
        configurable: true,
      });
    } catch (_) {}
    if (ua) {
      try {
        Object.defineProperty(nav, 'userAgent', {
          get: function () { return ua; },
          configurable: true,
        });
      } catch (_) {}
      try {
        Object.defineProperty(nav, 'appVersion', {
          get: function () { return String(ua).replace('Mozilla/', ''); },
          configurable: true,
        });
      } catch (_) {}
    }
    try {
      const uaData = nav.userAgentData;
      if (uaData && typeof uaData === 'object') {
        Object.defineProperty(nav, 'userAgentData', {
          get: function () {
            return {
              brands: uaData.brands,
              mobile: uaChMobile,
              platform: uaChPlatform,
              getHighEntropyValues: uaData.getHighEntropyValues
                ? uaData.getHighEntropyValues.bind(uaData)
                : undefined,
              toJSON: uaData.toJSON ? uaData.toJSON.bind(uaData) : undefined,
            };
          },
          configurable: true,
        });
      }
    } catch (_) {}
  }

  try { spoof(typeof self !== 'undefined' ? self.navigator : null); } catch (_) {}
  try {
    spoof(typeof WorkerNavigator !== 'undefined' ? WorkerNavigator.prototype : null);
  } catch (_) {}
  try {
    spoof(typeof Navigator !== 'undefined' ? Navigator.prototype : null);
  } catch (_) {}

  const GL_VENDOR = 0x1F00;
  const GL_RENDERER = 0x1F01;
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  function patchWebGl(proto) {
    if (!proto) return;
    if (!proto.__speculumWebglOrigGetParam) {
      try {
        Object.defineProperty(proto, '__speculumWebglOrigGetParam', {
          value: proto.getParameter,
          configurable: true,
        });
        Object.defineProperty(proto, '__speculumWebglOrigGetExt', {
          value: proto.getExtension,
          configurable: true,
        });
      } catch (_) {
        return;
      }
    }
    const origGetParam = proto.__speculumWebglOrigGetParam;
    const origGetExt = proto.__speculumWebglOrigGetExt;
    Object.defineProperty(proto, 'getParameter', {
      value: function (param) {
        if (param === GL_VENDOR) return webglVendor;
        if (param === GL_RENDERER) return webglRenderer;
        if (param === UNMASKED_VENDOR_WEBGL) return webglUnmaskedVendor;
        if (param === UNMASKED_RENDERER_WEBGL) return webglUnmaskedRenderer;
        return origGetParam.call(this, param);
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(proto, 'getExtension', {
      value: function (name) {
        const ext = origGetExt.call(this, name);
        if (name === 'WEBGL_debug_renderer_info') {
          return ext || {
            UNMASKED_VENDOR_WEBGL,
            UNMASKED_RENDERER_WEBGL,
          };
        }
        return ext;
      },
      writable: true,
      configurable: true,
    });
  }
  if (typeof WebGLRenderingContext !== 'undefined') {
    patchWebGl(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchWebGl(WebGL2RenderingContext.prototype);
  }
})();`;
}
/**
 * Main-world init: kit HW, WebGL UNMASKED, classic Worker/SharedWorker wrap.
 * Same identity with or without real GPU underneath.
 */
function kitStealthInitSource(args) {
    const { kit, userAgent } = args;
    const cores = kit.hardwareConcurrency;
    const mem = kit.deviceMemory;
    const platform = jsonString(kit.navigatorPlatform);
    const ua = jsonString(userAgent);
    const maskedVendor = jsonString(kit.webglVendor);
    const maskedRenderer = jsonString(kit.webglRenderer);
    const unmaskedVendor = jsonString(kit.webglUnmaskedVendor);
    const unmaskedRenderer = jsonString(kit.webglUnmaskedRenderer);
    const uaChPlatform = jsonString(kit.uaChPlatform);
    const uaChMobile = kit.mobile ? 'true' : 'false';
    return `(() => {
  const cores = ${cores};
  const mem = ${mem};
  const platform = ${platform};
  const ua = ${ua};
  const webglVendor = ${maskedVendor};
  const webglRenderer = ${maskedRenderer};
  const webglUnmaskedVendor = ${unmaskedVendor};
  const webglUnmaskedRenderer = ${unmaskedRenderer};
  const uaChPlatform = ${uaChPlatform};
  const uaChMobile = ${uaChMobile};

  function spoofNavigator(navProto) {
    if (!navProto) return;
    try {
      Object.defineProperty(navProto, 'hardwareConcurrency', {
        get: () => cores,
        configurable: true,
      });
    } catch (_) {}
    try {
      Object.defineProperty(navProto, 'deviceMemory', {
        get: () => mem,
        configurable: true,
      });
    } catch (_) {}
    if (ua) {
      try {
        Object.defineProperty(navProto, 'userAgent', {
          get: () => ua,
          configurable: true,
        });
      } catch (_) {}
      try {
        Object.defineProperty(navProto, 'appVersion', {
          get: () => ua.replace(/^Mozilla\\//, ''),
          configurable: true,
        });
      } catch (_) {}
    }
    try {
      Object.defineProperty(navProto, 'platform', {
        get: () => platform,
        configurable: true,
      });
    } catch (_) {}
    try {
      const uaData = navProto.userAgentData;
      if (uaData && typeof uaData === 'object') {
        Object.defineProperty(navProto, 'userAgentData', {
          get: () => ({
            ...uaData,
            mobile: uaChMobile,
            platform: uaChPlatform,
            get brands() { return uaData.brands; },
            getHighEntropyValues: uaData.getHighEntropyValues
              ? uaData.getHighEntropyValues.bind(uaData)
              : undefined,
            toJSON: uaData.toJSON ? uaData.toJSON.bind(uaData) : undefined,
          }),
          configurable: true,
        });
      }
    } catch (_) {}
  }

  spoofNavigator(typeof Navigator !== 'undefined' ? Navigator.prototype : null);
  spoofNavigator(typeof WorkerNavigator !== 'undefined' ? WorkerNavigator.prototype : null);

  const GL_VENDOR = 0x1F00;
  const GL_RENDERER = 0x1F01;
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  function patchWebGl(proto) {
    if (!proto) return;
    if (!proto.__speculumWebglOrigGetParam) {
      try {
        Object.defineProperty(proto, '__speculumWebglOrigGetParam', {
          value: proto.getParameter,
          configurable: true,
        });
        Object.defineProperty(proto, '__speculumWebglOrigGetExt', {
          value: proto.getExtension,
          configurable: true,
        });
      } catch (_) {
        return;
      }
    }
    const origGetParam = proto.__speculumWebglOrigGetParam;
    const origGetExt = proto.__speculumWebglOrigGetExt;
    Object.defineProperty(proto, 'getParameter', {
      value: function (param) {
        if (param === GL_VENDOR) return webglVendor;
        if (param === GL_RENDERER) return webglRenderer;
        if (param === UNMASKED_VENDOR_WEBGL) return webglUnmaskedVendor;
        if (param === UNMASKED_RENDERER_WEBGL) return webglUnmaskedRenderer;
        return origGetParam.call(this, param);
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(proto, 'getExtension', {
      value: function (name) {
        const ext = origGetExt.call(this, name);
        if (name === 'WEBGL_debug_renderer_info') {
          return ext || {
            UNMASKED_VENDOR_WEBGL,
            UNMASKED_RENDERER_WEBGL,
          };
        }
        return ext;
      },
      writable: true,
      configurable: true,
    });
  }
  if (typeof WebGLRenderingContext !== 'undefined') {
    patchWebGl(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchWebGl(WebGL2RenderingContext.prototype);
  }

  const workerPreamble =
    'self.__speculumKit={' +
    'cores:' + cores + ',' +
    'mem:' + mem + ',' +
    'platform:' + JSON.stringify(platform) + ',' +
    'ua:' + JSON.stringify(ua) +
    '};' +
    '(function(){var k=self.__speculumKit;' +
    'function spoof(nav){if(!nav)return;' +
    'try{Object.defineProperty(nav,"hardwareConcurrency",{get:function(){return k.cores},configurable:true});}catch(e){}' +
    'try{Object.defineProperty(nav,"deviceMemory",{get:function(){return k.mem},configurable:true});}catch(e){}' +
    'try{Object.defineProperty(nav,"platform",{get:function(){return k.platform},configurable:true});}catch(e){}' +
    'if(k.ua){try{Object.defineProperty(nav,"userAgent",{get:function(){return k.ua},configurable:true});}catch(e){}' +
    'try{Object.defineProperty(nav,"appVersion",{get:function(){return String(k.ua).replace("Mozilla/","")},configurable:true});}catch(e){}}' +
    '}' +
    'spoof(self.navigator);' +
    'try{spoof(WorkerNavigator&&WorkerNavigator.prototype);}catch(e){}' +
    'try{spoof(Navigator&&Navigator.prototype);}catch(e){}' +
    '})();';

  function resolveWorkerUrl(scriptURL) {
    const raw = String(scriptURL);
    try {
      return new URL(raw, self.location && self.location.href ? self.location.href : undefined).href;
    } catch (_) {
      return raw;
    }
  }

  function wrapWorker(Orig, displayName) {
    if (typeof Orig !== 'function') return Orig;
    function Wrapped(scriptURL, options) {
      if (options && typeof options === 'object' && options.type === 'module') {
        return new Orig(scriptURL, options);
      }
      try {
        const resolved = resolveWorkerUrl(scriptURL);
        const blob = new Blob(
          [workerPreamble + '\\nimportScripts(' + JSON.stringify(resolved) + ');'],
          { type: 'text/javascript' },
        );
        const blobUrl = URL.createObjectURL(blob);
        try {
          return new Orig(blobUrl, options);
        } finally {
          setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60_000);
        }
      } catch (_) {
        return new Orig(scriptURL, options);
      }
    }
    Wrapped.prototype = Orig.prototype;
    try {
      Object.defineProperty(Wrapped, 'name', { value: displayName });
    } catch (_) {}
    return Wrapped;
  }

  try {
    if (typeof Worker === 'function') {
      window.Worker = wrapWorker(Worker, 'Worker');
    }
  } catch (_) {}
  try {
    if (typeof SharedWorker === 'function') {
      window.SharedWorker = wrapWorker(SharedWorker, 'SharedWorker');
    }
  } catch (_) {}
})();`;
}
/** @deprecated Use kitStealthInitSource — kept for call-site clarity aliases. */
function kitHardwareSpoofSource(kit) {
    return kitStealthInitSource({ kit, userAgent: '' });
}
//# sourceMappingURL=device-kits.js.map