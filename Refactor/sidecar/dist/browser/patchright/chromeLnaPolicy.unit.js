"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runChromeLnaPolicyUnitTests = runChromeLnaPolicyUnitTests;
const assert_1 = __importDefault(require("assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const ChromeRuntime_1 = require("./ChromeRuntime");
function sidecarRoot() {
    const candidates = [
        node_path_1.default.join(__dirname, '..', '..'),
        node_path_1.default.join(__dirname, '..', '..', '..'),
    ];
    for (const root of candidates) {
        if (node_fs_1.default.existsSync(node_path_1.default.join(root, 'chrome-policies', 'managed', 'speculum-lna.json'))) {
            return root;
        }
    }
    throw new Error('sidecar root not found for LNA policy unit');
}
function runChromeLnaPolicyUnitTests() {
    const root = sidecarRoot();
    const policyPath = node_path_1.default.join(root, 'chrome-policies', 'managed', 'speculum-lna.json');
    assert_1.default.ok(node_fs_1.default.existsSync(policyPath), `missing LNA policy ${policyPath}`);
    const policy = JSON.parse(node_fs_1.default.readFileSync(policyPath, 'utf8'));
    assert_1.default.deepStrictEqual(policy.LoopbackNetworkAllowedForUrls, ['*']);
    assert_1.default.deepStrictEqual(policy.LocalNetworkAccessAllowedForUrls, ['*']);
    const args = (0, ChromeRuntime_1.buildChromeArgs)(1280, 720);
    const disableFeatures = args.find((a) => a.startsWith('--disable-features=')) ?? '';
    assert_1.default.ok(!disableFeatures.includes('LocalNetworkAccessChecks'), 'buildChromeArgs must not disable LocalNetworkAccessChecks (policy-only LNA)');
    const entrypoint = node_path_1.default.join(root, 'docker-entrypoint.sh');
    assert_1.default.ok(node_fs_1.default.existsSync(entrypoint), `missing docker-entrypoint ${entrypoint}`);
    const entrySrc = node_fs_1.default.readFileSync(entrypoint, 'utf8');
    assert_1.default.ok(entrySrc.includes('ensure_chrome_lna_policies'), 'docker-entrypoint must install chrome LNA policies');
    console.log('[unit] chrome LNA policy ok');
}
//# sourceMappingURL=chromeLnaPolicy.unit.js.map