import { peekFrameHeader } from '../../packages/page-projection/src/core/decode';
import { createProjectionClient } from '../../packages/page-projection/src/projected/ProjectionClient';

async function replayFrames(framesB64: string[]): Promise<Record<string, unknown>> {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.cssText = 'position:relative;width:1280px;height:720px';
  const errors: Record<string, unknown>[] = [];
  let applyOk = 0;
  let applyFail = 0;
  const client = await createProjectionClient({
    surfaceHost: host,
    onTelemetry: (m) => {
      const kind = m.kind;
      if (kind === 'applyResult') {
        if (m.ok === true) applyOk += 1;
        else applyFail += 1;
      }
      if (kind === 'desynced' || kind === 'desync' || kind === 'applyGateOverflow') {
        errors.push({ ...m });
      }
    },
  });
  let ingested = 0;
  let sequenceBootstrapped = false;
  for (const b64 of framesB64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!sequenceBootstrapped) {
      const hdr = peekFrameHeader(bytes);
      if (hdr && hdr.sequence > 1 && !hdr.resync) {
        client.adoptSequenceContext(hdr.sequence);
      }
      sequenceBootstrapped = true;
    }
    client.ingest(bytes);
    client.flush();
    ingested++;
    // Yield so ProjectedApplyGate can drain (burst replay ≠ live 60 Hz).
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    if (client.desynced) break;
  }
  return {
    wire: framesB64.length,
    ingested,
    applyOk,
    applyFail,
    desynced: client.desynced,
    applyError: client.applyError,
    lastSeq: client.lastAcceptedSequence,
    generation: client.getGeneration(),
    armed: client.isArmed,
    bodyLen: client.document.body?.innerHTML?.length ?? 0,
    errors,
  };
}

declare global {
  interface Window {
    __speculumReplayFrames: typeof replayFrames;
    SpeculumReplay?: { replayFrames: typeof replayFrames };
  }
}
window.__speculumReplayFrames = replayFrames;
window.SpeculumReplay = { replayFrames };
