"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listLiveInputSessions = listLiveInputSessions;
exports.disableForeignDevicesOnDisplay = disableForeignDevicesOnDisplay;
exports.registerIsolatedInput = registerIsolatedInput;
exports.unregisterIsolatedInput = unregisterIsolatedInput;
exports.disableNamedDevices = disableNamedDevices;
exports.enableNamedDevices = enableNamedDevices;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * uinput nodes are host-global; every Xorg with AutoAddDevices will see them.
 * Track live sessions and xinput-disable foreign Speculum devices per DISPLAY
 * so clicks on session A do not also land on session B.
 */
const live = new Map();
function listLiveInputSessions() {
    return [...live.values()];
}
/** Right after a new Xorg is up — drop every known foreign Speculum device on it. */
async function disableForeignDevicesOnDisplay(displayEnv) {
    for (const other of live.values()) {
        if (other.displayEnv === displayEnv)
            continue;
        await disableNamedDevices(displayEnv, other.deviceNames);
    }
}
async function registerIsolatedInput(devices) {
    live.set(devices.sessionId, {
        sessionId: devices.sessionId,
        displayEnv: devices.displayEnv,
        deviceNames: [...devices.deviceNames],
    });
    await rebalanceIsolation();
}
async function unregisterIsolatedInput(sessionId) {
    live.delete(sessionId);
    await rebalanceIsolation();
}
async function rebalanceIsolation() {
    const sessions = [...live.values()];
    for (const target of sessions) {
        for (const other of sessions) {
            if (other.sessionId === target.sessionId)
                continue;
            await disableNamedDevices(target.displayEnv, other.deviceNames);
        }
    }
}
function nameListed(listed, name) {
    for (const line of listed.split(/\r?\n/)) {
        if (line.trim() === name)
            return true;
    }
    return false;
}
/** Disable devices by name on a display (best-effort; missing names are ignored). */
async function disableNamedDevices(displayEnv, names) {
    if (names.length === 0)
        return;
    const env = { ...process.env, DISPLAY: displayEnv };
    let listed;
    try {
        const { stdout } = await execFileAsync('xinput', ['list', '--name-only'], { env });
        listed = stdout;
    }
    catch {
        return;
    }
    for (const name of names) {
        if (!nameListed(listed, name))
            continue;
        try {
            await execFileAsync('xinput', ['disable', name], { env });
        }
        catch {
            /* device may already be gone */
        }
    }
}
/** Ensure our session devices remain enabled on their own display. */
async function enableNamedDevices(displayEnv, names) {
    if (names.length === 0)
        return;
    const env = { ...process.env, DISPLAY: displayEnv };
    for (const name of names) {
        try {
            await execFileAsync('xinput', ['enable', name], { env });
        }
        catch {
            /* */
        }
    }
}
//# sourceMappingURL=display-isolation.js.map