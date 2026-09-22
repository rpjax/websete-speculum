import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as W from "../../wire-clients/ts/speculum_wire.gen.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const goldenDir = join(root, "domain/wire/testdata/golden");
const meta = JSON.parse(readFileSync(join(goldenDir, "fixtures.json"), "utf8"));

let fails = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL", msg);
    fails++;
  }
}

check(W.MESSAGE_COUNT === 48, "MESSAGE_COUNT 48");
check(W.SCHEMA_SHA256 === meta.schema_sha256, "schema hash");

type Codec = {
  dec: (b: Uint8Array) => unknown;
  enc: (v: any) => Uint8Array;
};

const codecs: Record<string, Codec> = {
  Ready: { dec: W.decodeReadyBytes, enc: W.encodeReadyBytes },
  Shutdown: { dec: W.decodeShutdownBytes, enc: W.encodeShutdownBytes },
  Heartbeat: { dec: W.decodeHeartbeatBytes, enc: W.encodeHeartbeatBytes },
  FreezeAll: { dec: W.decodeFreezeAllBytes, enc: W.encodeFreezeAllBytes },
  CaptureState: { dec: W.decodeCaptureStateBytes, enc: W.encodeCaptureStateBytes },
  ThawAll: { dec: W.decodeThawAllBytes, enc: W.encodeThawAllBytes },
  Probe: { dec: W.decodeProbeBytes, enc: W.encodeProbeBytes },
  ViewportOpen: { dec: W.decodeViewportOpenBytes, enc: W.encodeViewportOpenBytes },
  ViewportClose: { dec: W.decodeViewportCloseBytes, enc: W.encodeViewportCloseBytes },
  ViewportResize: { dec: W.decodeViewportResizeBytes, enc: W.encodeViewportResizeBytes },
  Navigate: { dec: W.decodeNavigateBytes, enc: W.encodeNavigateBytes },
  Reload: { dec: W.decodeReloadBytes, enc: W.encodeReloadBytes },
  StopLoad: { dec: W.decodeStopLoadBytes, enc: W.encodeStopLoadBytes },
  HistoryGo: { dec: W.decodeHistoryGoBytes, enc: W.encodeHistoryGoBytes },
  HostResize: { dec: W.decodeHostResizeBytes, enc: W.encodeHostResizeBytes },
  Resync: { dec: W.decodeResyncBytes, enc: W.encodeResyncBytes },
  ClocksHalt: { dec: W.decodeClocksHaltBytes, enc: W.encodeClocksHaltBytes },
  ClocksResume: { dec: W.decodeClocksResumeBytes, enc: W.encodeClocksResumeBytes },
  PromptRespond: { dec: W.decodePromptRespondBytes, enc: W.encodePromptRespondBytes },
  Flush: { dec: W.decodeFlushBytes, enc: W.encodeFlushBytes },
  Snapshot: { dec: W.decodeSnapshotBytes, enc: W.encodeSnapshotBytes },
  InputPointerDown: { dec: W.decodeInputPointerDownBytes, enc: W.encodeInputPointerDownBytes },
  InputPointerUp: { dec: W.decodeInputPointerUpBytes, enc: W.encodeInputPointerUpBytes },
  InputKeyDown: { dec: W.decodeInputKeyDownBytes, enc: W.encodeInputKeyDownBytes },
  InputKeyUp: { dec: W.decodeInputKeyUpBytes, enc: W.encodeInputKeyUpBytes },
  InputScroll: { dec: W.decodeInputScrollBytes, enc: W.encodeInputScrollBytes },
  AssetRequest: { dec: W.decodeAssetRequestBytes, enc: W.encodeAssetRequestBytes },
  AssetCancel: { dec: W.decodeAssetCancelBytes, enc: W.encodeAssetCancelBytes },
  ViewportOpened: { dec: W.decodeViewportOpenedBytes, enc: W.encodeViewportOpenedBytes },
  ViewportClosed: { dec: W.decodeViewportClosedBytes, enc: W.encodeViewportClosedBytes },
  HostAttached: { dec: W.decodeHostAttachedBytes, enc: W.encodeHostAttachedBytes },
  HostDetached: { dec: W.decodeHostDetachedBytes, enc: W.encodeHostDetachedBytes },
  DocumentInstalled: { dec: W.decodeDocumentInstalledBytes, enc: W.encodeDocumentInstalledBytes },
  DocumentDiscarded: { dec: W.decodeDocumentDiscardedBytes, enc: W.encodeDocumentDiscardedBytes },
  Navigated: { dec: W.decodeNavigatedBytes, enc: W.encodeNavigatedBytes },
  LoadStateChanged: { dec: W.decodeLoadStateChangedBytes, enc: W.encodeLoadStateChangedBytes },
  PromptRequested: { dec: W.decodePromptRequestedBytes, enc: W.encodePromptRequestedBytes },
  PromptAbandoned: { dec: W.decodePromptAbandonedBytes, enc: W.encodePromptAbandonedBytes },
  Patch: { dec: W.decodePatchBytes, enc: W.encodePatchBytes },
  Snapshotted: { dec: W.decodeSnapshottedBytes, enc: W.encodeSnapshottedBytes },
  AssetChunk: { dec: W.decodeAssetChunkBytes, enc: W.encodeAssetChunkBytes },
  AssetEnd: { dec: W.decodeAssetEndBytes, enc: W.encodeAssetEndBytes },
  AssetDenied: { dec: W.decodeAssetDeniedBytes, enc: W.encodeAssetDeniedBytes },
  Fault: { dec: W.decodeFaultBytes, enc: W.encodeFaultBytes },
  FreezeResult: { dec: W.decodeFreezeResultBytes, enc: W.encodeFreezeResultBytes },
  StateCaptured: { dec: W.decodeStateCapturedBytes, enc: W.encodeStateCapturedBytes },
  ProbeResult: { dec: W.decodeProbeResultBytes, enc: W.encodeProbeResultBytes },
  Telemetry: { dec: W.decodeTelemetryBytes, enc: W.encodeTelemetryBytes },
};

const names = Object.keys(meta.fixtures);
check(names.length === 48, "48 fixtures");
check(Object.keys(codecs).length === 48, "48 codecs registered");

for (const name of names) {
  const bin = new Uint8Array(readFileSync(join(goldenDir, `${name}.bin`)));
  const c = codecs[name];
  check(!!c, `codec ${name}`);
  const msg = c.dec(bin);
  const again = c.enc(msg);
  check(
    again.length === bin.length && again.every((b, i) => b === bin[i]),
    `roundtrip ${name}`
  );
}

if (fails) {
  console.error(fails, "failure(s)");
  process.exit(1);
}
console.log("PASS phase1_ts");
