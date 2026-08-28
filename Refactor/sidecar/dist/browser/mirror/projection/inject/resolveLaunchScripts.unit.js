"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runResolveLaunchScriptsUnitTests = runResolveLaunchScriptsUnitTests;
const assert_1 = __importDefault(require("assert"));
const resolveLaunchScripts_1 = require("./resolveLaunchScripts");
async function runResolveLaunchScriptsUnitTests() {
    const scripts = [
        {
            position: 'HeaderTop',
            type: 'Classic',
            file: '/kit/stored.js',
            content: 'globalThis.__STORED=1;',
            targetRules: [
                {
                    domain: { scope: 'Any', labels: [] },
                    path: { scope: 'Any', matchType: 'Exact', segments: [] },
                },
            ],
        },
    ];
    const resolved = await (0, resolveLaunchScripts_1.resolveLaunchScripts)(scripts);
    assert_1.default.strictEqual(resolved.length, 1);
    assert_1.default.ok(resolved[0].wrappedSource.includes('__STORED=1'));
    assert_1.default.ok(resolved[0].wrappedSource.includes('__speculumLaunchUrlMatch'));
    console.log('[unit] resolveLaunchScripts ok');
}
//# sourceMappingURL=resolveLaunchScripts.unit.js.map