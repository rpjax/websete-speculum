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
    const labRootCandidates = [
        node_path_1.default.join(__dirname), // lab/ when assetRoots lives at lab root
        node_path_1.default.join(__dirname, '..'), // when imported from host/ or runner/
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab'),
        node_path_1.default.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'lab'),
    ];
    const labRoot = labRootCandidates.find((p) => node_fs_1.default.existsSync(node_path_1.default.join(p, 'fixtures')) || node_fs_1.default.existsSync(node_path_1.default.join(p, 'static'))) ?? node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab');
    const staticDir = [
        node_path_1.default.join(labRoot, 'static'),
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static'),
    ].find((p) => node_fs_1.default.existsSync(p)) ?? node_path_1.default.join(labRoot, 'static');
    const fixturesDir = [
        node_path_1.default.join(labRoot, 'fixtures'),
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'fixtures'),
    ].find((p) => node_fs_1.default.existsSync(p)) ?? node_path_1.default.join(labRoot, 'fixtures');
    return { staticDir, fixturesDir, labRoot };
}
//# sourceMappingURL=assetRoots.js.map