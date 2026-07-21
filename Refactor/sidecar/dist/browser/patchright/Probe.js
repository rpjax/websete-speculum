"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Probe = void 0;
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