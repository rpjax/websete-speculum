import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type IsolatedInputDevices = {
  sessionId: string;
  displayEnv: string;
  deviceNames: readonly string[];
};

/**
 * uinput nodes are host-global; every Xorg with AutoAddDevices will see them.
 * Track live sessions and xinput-disable foreign Speculum devices per DISPLAY
 * so clicks on session A do not also land on session B.
 */
const live = new Map<string, IsolatedInputDevices>();

export function listLiveInputSessions(): IsolatedInputDevices[] {
  return [...live.values()];
}

/** Right after a new Xorg is up — drop every known foreign Speculum device on it. */
export async function disableForeignDevicesOnDisplay(displayEnv: string): Promise<void> {
  for (const other of live.values()) {
    if (other.displayEnv === displayEnv) continue;
    await disableNamedDevices(displayEnv, other.deviceNames);
  }
}

export async function registerIsolatedInput(devices: IsolatedInputDevices): Promise<void> {
  live.set(devices.sessionId, {
    sessionId: devices.sessionId,
    displayEnv: devices.displayEnv,
    deviceNames: [...devices.deviceNames],
  });
  await rebalanceIsolation();
}

export async function unregisterIsolatedInput(sessionId: string): Promise<void> {
  live.delete(sessionId);
  await rebalanceIsolation();
}

async function rebalanceIsolation(): Promise<void> {
  const sessions = [...live.values()];
  for (const target of sessions) {
    for (const other of sessions) {
      if (other.sessionId === target.sessionId) continue;
      await disableNamedDevices(target.displayEnv, other.deviceNames);
    }
  }
}

function nameListed(listed: string, name: string): boolean {
  for (const line of listed.split(/\r?\n/)) {
    if (line.trim() === name) return true;
  }
  return false;
}

/** Disable devices by name on a display (best-effort; missing names are ignored). */
export async function disableNamedDevices(
  displayEnv: string,
  names: readonly string[],
): Promise<void> {
  if (names.length === 0) return;
  const env = { ...process.env as Record<string, string>, DISPLAY: displayEnv };
  let listed: string;
  try {
    const { stdout } = await execFileAsync('xinput', ['list', '--name-only'], { env });
    listed = stdout;
  } catch {
    return;
  }
  for (const name of names) {
    if (!nameListed(listed, name)) continue;
    try {
      await execFileAsync('xinput', ['disable', name], { env });
    } catch {
      /* device may already be gone */
    }
  }
}

/** Ensure our session devices remain enabled on their own display. */
export async function enableNamedDevices(
  displayEnv: string,
  names: readonly string[],
): Promise<void> {
  if (names.length === 0) return;
  const env = { ...process.env as Record<string, string>, DISPLAY: displayEnv };
  for (const name of names) {
    try {
      await execFileAsync('xinput', ['enable', name], { env });
    } catch {
      /* */
    }
  }
}
