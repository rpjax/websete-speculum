"use strict";
/**
 * Shared uinput event-node plumbing (dedupe of the identical helpers that were
 * copy-pasted between {@link AbsOsInputStack} (PP/ABS) and `OsInputBackend`
 * (Video/REL) — Fase 2.1). Pure `/proc` + `/sys` + `mknod` device discovery;
 * no ABS/REL-specific behaviour lives here.
 */
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
exports.listInputHandlers = listInputHandlers;
exports.ensureInputEventNodes = ensureInputEventNodes;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
function listInputHandlers(...deviceNames) {
    const wanted = new Set(deviceNames.filter((n) => n.length > 0));
    if (wanted.size === 0)
        return [];
    let text;
    try {
        text = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    }
    catch {
        return [];
    }
    const out = [];
    for (const block of text.split('\n\n')) {
        const nameMatch = block.match(/^N: Name="([^"]+)"/m);
        const handlersMatch = block.match(/^H: Handlers=([^\n]+)/m);
        if (!nameMatch || !handlersMatch)
            continue;
        if (!wanted.has(nameMatch[1]))
            continue;
        for (const token of handlersMatch[1].trim().split(/\s+/)) {
            if (!/^event\d+$/.test(token))
                continue;
            out.push({ name: nameMatch[1], event: token });
        }
    }
    return out;
}
/**
 * Docker does not auto-create /dev/input/eventN for container-born uinput.
 * With device_cgroup_rules c 13:* we mknod from sysfs so Xorg Option "Device" works.
 */
function ensureInputEventNodes(...deviceNames) {
    try {
        fs.mkdirSync('/dev/input', { recursive: true });
    }
    catch {
        /* */
    }
    for (const { event } of listInputHandlers(...deviceNames)) {
        const node = `/dev/input/${event}`;
        if (fs.existsSync(node))
            continue;
        let majMin;
        try {
            majMin = fs.readFileSync(`/sys/class/input/${event}/dev`, 'utf8').trim();
        }
        catch {
            continue;
        }
        const [majS, minS] = majMin.split(':');
        const major = Number(majS);
        const minor = Number(minS);
        if (!Number.isInteger(major) || !Number.isInteger(minor))
            continue;
        try {
            (0, node_child_process_1.execFileSync)('mknod', [node, 'c', String(major), String(minor)]);
            fs.chmodSync(node, 0o666);
        }
        catch {
            /* host may already own the node */
        }
    }
}
//# sourceMappingURL=eventNodes.js.map