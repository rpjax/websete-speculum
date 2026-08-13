"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Probe = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
class Probe {
    async run(request, ctx) {
        try {
            const opSet = new Set(request.ops);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = {};
            if (opSet.has('tabs')) {
                const pages = ctx.context.pages();
                data.tabs = {
                    tabCount: pages.length,
                    urls: pages.map((p) => {
                        try {
                            return p.url();
                        }
                        catch {
                            return '';
                        }
                    }),
                };
            }
            if (opSet.has('cookies')) {
                const result = (await ctx.cdp.send('Network.getAllCookies'));
                data.cookies = (result.cookies ?? []).slice(0, 50);
            }
            if (opSet.has('process') && ctx.display) {
                const geo = await ctx.display.readActiveGeometry().catch(() => ({
                    width: 0,
                    height: 0,
                }));
                data.process = {
                    display: ctx.display.displayEnv,
                    activeWidth: geo.width,
                    activeHeight: geo.height,
                    userDataDirExists: true,
                };
            }
            if (opSet.has('dom') && request.domSelector) {
                const sel = JSON.stringify(request.domSelector);
                data.dom = await ctx.page.evaluate(`(() => {
          const el = document.querySelector(${sel});
          if (!el) return null;
          return { outerHTML: el.outerHTML.slice(0, 8192), text: el.textContent };
        })()`);
            }
            if (opSet.has('evaluate') && request.evaluateExpression) {
                data.evaluate = await ctx.page.evaluate(request.evaluateExpression);
            }
            // Viewport still of Speculum Virtual — O1 accept bar (not host Playwright).
            // Always spill to a sidecar temp path so gRPC/JSON probe budgets never truncate PNGs.
            if (opSet.has('screenshot')) {
                const buf = await ctx.page.screenshot({ type: 'png', fullPage: false });
                const file = path.join(os.tmpdir(), `speculum-virtual-still-${Date.now()}.png`);
                fs.writeFileSync(file, buf);
                data.screenshot = { path: file, byteLength: buf.byteLength };
            }
            return { ok: true, data };
        }
        catch (err) {
            return {
                ok: false,
                errorCode: 'probe_failed',
                message: err.message?.slice(0, 512),
            };
        }
    }
}
exports.Probe = Probe;
//# sourceMappingURL=Probe.js.map