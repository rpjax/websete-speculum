"use strict";
/**
 * Lab static / fixture roots for ts-node and compiled dist layouts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.labAssetRoots = labAssetRoots;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function labAssetRoots() {
    const candidates = [
        node_path_1.default.join(__dirname, 'static'),
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static'),
        node_path_1.default.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'lab', 'static'),
    ];
    const staticDir = candidates.find((p) => node_fs_1.default.existsSync(p)) ??
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static');
    return {
        staticDir,
        fixturesDir: node_path_1.default.join(staticDir, 'fixtures'),
    };
}
//# sourceMappingURL=assetRoots.js.map