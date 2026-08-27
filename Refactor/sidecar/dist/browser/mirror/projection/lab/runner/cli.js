"use strict";
/**
 * Agent CLI — lab:run --blueprint …
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const assetRoots_1 = require("../assetRoots");
const chassis_1 = require("../host/chassis");
const loadBlueprint_1 = require("./loadBlueprint");
const execute_1 = require("./execute");
const types_1 = require("../dossier/types");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
const fixtureServe_1 = require("../fixtureServe");
function parseDuration(raw) {
    const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(raw.trim());
    if (!m)
        return Number.NaN;
    const n = Number(m[1]);
    const u = (m[2] ?? 'ms').toLowerCase();
    if (u === 's')
        return Math.round(n * 1000);
    if (u === 'm')
        return Math.round(n * 60_000);
    return Math.round(n);
}
function parseArgs(argv) {
    const args = {
        blueprint: 'soak',
        durationMs: 15_000,
        cpu: false,
        invariants: true,
        headed: process.env.SPECULUM_LAB_HEADED === '1',
        telemetryOff: false,
    };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--blueprint' || t === '-b') {
            args.blueprint = argv[++i] ?? args.blueprint;
        }
        else if (t === '--url') {
            args.url = argv[++i];
        }
        else if (t === '--duration') {
            args.durationMs = parseDuration(argv[++i] ?? '');
        }
        else if (t === '--out') {
            args.outDir = argv[++i];
        }
        else if (t === '--cpu' || t === 'cpu')
            args.cpu = true;
        else if (t === '--iso' || t === 'iso')
            args.iso = true;
        else if (t === '--no-invariants')
            args.invariants = false;
        else if (t === '--headed' || t === 'headed')
            args.headed = true;
        else if (t === '--telemetry' && argv[i + 1] === 'off') {
            args.telemetryOff = true;
            i++;
        }
        else if (!t.startsWith('-'))
            rest.push(t);
    }
    // positional: [blueprint?] [url?] [duration?] — keep soak default
    if (rest[0] && !rest[0].includes('.') && !rest[0].startsWith('fixtures/') && !/^https?:/i.test(rest[0])) {
        if ((0, loadBlueprint_1.listBlueprintIds)().includes(rest[0])) {
            args.blueprint = rest.shift();
        }
    }
    // duration-looking tokens are not URLs (Windows npm often strips `--duration`)
    const asDuration = (raw) => {
        if (!raw)
            return null;
        if (!/^\d+(\.\d+)?(ms|s|m)?$/i.test(raw.trim()))
            return null;
        const d = parseDuration(raw);
        return Number.isFinite(d) ? d : null;
    };
    if (rest[0]) {
        const d0 = asDuration(rest[0]);
        if (d0 !== null) {
            args.durationMs = d0;
            rest.shift();
        }
        else {
            args.url = rest.shift();
        }
    }
    if (rest[0]) {
        const d1 = asDuration(rest[0]);
        if (d1 !== null)
            args.durationMs = d1;
    }
    return args;
}
async function startFixtureHttp() {
    const { fixturesDir } = (0, assetRoots_1.labAssetRoots)();
    const server = node_http_1.default.createServer((req, res) => {
        const url = req.url ?? '/';
        if (!url.startsWith('/fixtures/')) {
            res.writeHead(404).end();
            return;
        }
        const pathname = url.split('?')[0] ?? url;
        const file = node_path_1.default.join(fixturesDir, decodeURIComponent(pathname.slice('/fixtures/'.length)));
        if (!file.startsWith(node_path_1.default.normalize(fixturesDir))) {
            res.writeHead(400).end('bad path');
            return;
        }
        (0, fixtureServe_1.pipeFixtureFile)(res, file);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string')
        throw new Error('fixture http: no port');
    return {
        origin: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const httpServer = await startFixtureHttp();
    const resolveUrl = (raw) => {
        if (/^https?:\/\//i.test(raw))
            return raw;
        const pathPart = raw.replace(/^\/+/, '');
        const rel = pathPart.startsWith('fixtures/') ? pathPart : `fixtures/${pathPart}`;
        return `${httpServer.origin}/${rel}`;
    };
    const chassis = new chassis_1.LabChassis({ headless: !args.headed, outDir: args.outDir });
    try {
        const bp = (0, loadBlueprint_1.loadBlueprint)(args.blueprint);
        const result = await (0, execute_1.executeBlueprint)(bp, {
            chassis,
            resolveUrl,
            overrides: {
                url: args.url,
                durationMs: args.durationMs,
                cpu: args.cpu,
                iso: args.iso,
                invariants: args.invariants,
                telemetry: args.telemetryOff ? { enabled: false } : { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
                outDir: args.outDir,
            },
        });
        for (const v of result.verdicts) {
            const tag = v.status === 'pass' ? 'PASS' : v.status === 'fail' ? 'FAIL' : 'SKIP';
            console.log(`${tag} ${v.id}: ${v.reason}`);
        }
        const dir = result.dossierDir ?? '';
        console.log(dir);
        process.exitCode = (0, types_1.reportExitCode)(result.verdicts);
    }
    finally {
        await chassis.dispose();
        await httpServer.close();
    }
}
void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map