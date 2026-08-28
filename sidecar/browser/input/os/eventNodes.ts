/**
 * Shared uinput event-node plumbing (dedupe of the identical helpers that were
 * copy-pasted between {@link AbsOsInputStack} (PP/ABS) and `OsInputBackend`
 * (Video/REL) — Fase 2.1). Pure `/proc` + `/sys` + `mknod` device discovery;
 * no ABS/REL-specific behaviour lives here.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

export type InputHandlerRef = { name: string; event: string };

export function listInputHandlers(...deviceNames: string[]): InputHandlerRef[] {
  const wanted = new Set(deviceNames.filter((n) => n.length > 0));
  if (wanted.size === 0) return [];
  let text: string;
  try {
    text = fs.readFileSync('/proc/bus/input/devices', 'utf8');
  } catch {
    return [];
  }
  const out: InputHandlerRef[] = [];
  for (const block of text.split('\n\n')) {
    const nameMatch = block.match(/^N: Name="([^"]+)"/m);
    const handlersMatch = block.match(/^H: Handlers=([^\n]+)/m);
    if (!nameMatch || !handlersMatch) continue;
    if (!wanted.has(nameMatch[1]!)) continue;
    for (const token of handlersMatch[1]!.trim().split(/\s+/)) {
      if (!/^event\d+$/.test(token)) continue;
      out.push({ name: nameMatch[1]!, event: token });
    }
  }
  return out;
}

/**
 * Docker does not auto-create /dev/input/eventN for container-born uinput.
 * With device_cgroup_rules c 13:* we mknod from sysfs so Xorg Option "Device" works.
 */
export function ensureInputEventNodes(...deviceNames: string[]): void {
  try {
    fs.mkdirSync('/dev/input', { recursive: true });
  } catch {
    /* */
  }
  for (const { event } of listInputHandlers(...deviceNames)) {
    const node = `/dev/input/${event}`;
    if (fs.existsSync(node)) continue;
    let majMin: string;
    try {
      majMin = fs.readFileSync(`/sys/class/input/${event}/dev`, 'utf8').trim();
    } catch {
      continue;
    }
    const [majS, minS] = majMin.split(':');
    const major = Number(majS);
    const minor = Number(minS);
    if (!Number.isInteger(major) || !Number.isInteger(minor)) continue;
    try {
      execFileSync('mknod', [node, 'c', String(major), String(minor)]);
      fs.chmodSync(node, 0o666);
    } catch {
      /* host may already own the node */
    }
  }
}
