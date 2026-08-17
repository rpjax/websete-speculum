"use strict";
/**
 * Load blueprint JSON from lab/blueprints.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blueprintsDir = blueprintsDir;
exports.listBlueprintIds = listBlueprintIds;
exports.defaultUrlFromBlueprint = defaultUrlFromBlueprint;
exports.summarizeBlueprint = summarizeBlueprint;
exports.listBlueprintSummaries = listBlueprintSummaries;
exports.loadBlueprint = loadBlueprint;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const assetRoots_1 = require("../assetRoots");
function blueprintsDir() {
    const { labRoot } = (0, assetRoots_1.labAssetRoots)();
    const candidates = [
        node_path_1.default.join(labRoot, 'blueprints'),
        node_path_1.default.join(__dirname, '..', 'blueprints'),
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'blueprints'),
    ];
    return candidates.find((p) => node_fs_1.default.existsSync(p)) ?? candidates[0];
}
function listBlueprintIds() {
    const dir = blueprintsDir();
    if (!node_fs_1.default.existsSync(dir))
        return [];
    return node_fs_1.default
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
}
function defaultUrlFromBlueprint(bp) {
    for (const q of bp.queues) {
        for (const a of q.actions) {
            if (a.type === 'boot' && typeof a.params?.url === 'string')
                return a.params.url;
        }
    }
    return null;
}
function summarizeBlueprint(bp) {
    return {
        id: bp.id,
        description: bp.description,
        defaultUrl: defaultUrlFromBlueprint(bp),
        acceptsSoakOverrides: bp.id === 'soak' || bp.fold === 'soak',
    };
}
function listBlueprintSummaries() {
    return listBlueprintIds()
        .map((id) => summarizeBlueprint(loadBlueprint(id)))
        .sort((a, b) => a.id.localeCompare(b.id));
}
function loadBlueprint(id) {
    const file = node_path_1.default.join(blueprintsDir(), `${id}.json`);
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`blueprint not found: ${id}`);
    return JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
}
//# sourceMappingURL=loadBlueprint.js.map