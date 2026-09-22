using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using Speculum.Wire;

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
if (!Directory.Exists(Path.Combine(root, "domain")))
{
    root = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory()));
}
if (!Directory.Exists(Path.Combine(root, "domain")))
{
    // cwd may be gecko-engine when invoked from run.ps1
    root = Path.GetFullPath(Directory.GetCurrentDirectory());
}
var goldenDir = Path.Combine(root, "domain", "wire", "testdata", "golden");
var metaJson = File.ReadAllText(Path.Combine(goldenDir, "fixtures.json"));
using var doc = JsonDocument.Parse(metaJson);
var fixtures = doc.RootElement.GetProperty("fixtures");
var hash = doc.RootElement.GetProperty("schema_sha256").GetString();
var count = doc.RootElement.GetProperty("message_count").GetInt32();

int fails = 0;
void Check(bool c, string m)
{
    if (!c) { Console.Error.WriteLine("FAIL " + m); fails++; }
}

Check(SchemaMeta.MessageCount == 48, "MessageCount");
Check(SchemaMeta.Sha256 == hash, "schema hash");
Check(count == 48, "fixture count");

foreach (var prop in fixtures.EnumerateObject())
{
    var name = prop.Name;
    var bin = File.ReadAllBytes(Path.Combine(goldenDir, name + ".bin"));
    var again = Roundtrip(name, bin);
    Check(again != null && again.SequenceEqual(bin), "roundtrip " + name);
}

if (fails != 0)
{
    Console.Error.WriteLine(fails + " failure(s)");
    return 1;
}
Console.WriteLine("PASS phase1_cs");
return 0;

static byte[]? Roundtrip(string name, byte[] bin) => name switch
{
    "Ready" => Codecs.EncodeReadyBytes(Codecs.DecodeReadyBytes(bin)),
    "Shutdown" => Codecs.EncodeShutdownBytes(Codecs.DecodeShutdownBytes(bin)),
    "Heartbeat" => Codecs.EncodeHeartbeatBytes(Codecs.DecodeHeartbeatBytes(bin)),
    "FreezeAll" => Codecs.EncodeFreezeAllBytes(Codecs.DecodeFreezeAllBytes(bin)),
    "CaptureState" => Codecs.EncodeCaptureStateBytes(Codecs.DecodeCaptureStateBytes(bin)),
    "ThawAll" => Codecs.EncodeThawAllBytes(Codecs.DecodeThawAllBytes(bin)),
    "Probe" => Codecs.EncodeProbeBytes(Codecs.DecodeProbeBytes(bin)),
    "ViewportOpen" => Codecs.EncodeViewportOpenBytes(Codecs.DecodeViewportOpenBytes(bin)),
    "ViewportClose" => Codecs.EncodeViewportCloseBytes(Codecs.DecodeViewportCloseBytes(bin)),
    "ViewportResize" => Codecs.EncodeViewportResizeBytes(Codecs.DecodeViewportResizeBytes(bin)),
    "Navigate" => Codecs.EncodeNavigateBytes(Codecs.DecodeNavigateBytes(bin)),
    "Reload" => Codecs.EncodeReloadBytes(Codecs.DecodeReloadBytes(bin)),
    "StopLoad" => Codecs.EncodeStopLoadBytes(Codecs.DecodeStopLoadBytes(bin)),
    "HistoryGo" => Codecs.EncodeHistoryGoBytes(Codecs.DecodeHistoryGoBytes(bin)),
    "HostResize" => Codecs.EncodeHostResizeBytes(Codecs.DecodeHostResizeBytes(bin)),
    "Resync" => Codecs.EncodeResyncBytes(Codecs.DecodeResyncBytes(bin)),
    "ClocksHalt" => Codecs.EncodeClocksHaltBytes(Codecs.DecodeClocksHaltBytes(bin)),
    "ClocksResume" => Codecs.EncodeClocksResumeBytes(Codecs.DecodeClocksResumeBytes(bin)),
    "PromptRespond" => Codecs.EncodePromptRespondBytes(Codecs.DecodePromptRespondBytes(bin)),
    "Flush" => Codecs.EncodeFlushBytes(Codecs.DecodeFlushBytes(bin)),
    "Snapshot" => Codecs.EncodeSnapshotBytes(Codecs.DecodeSnapshotBytes(bin)),
    "InputPointerDown" => Codecs.EncodeInputPointerDownBytes(Codecs.DecodeInputPointerDownBytes(bin)),
    "InputPointerUp" => Codecs.EncodeInputPointerUpBytes(Codecs.DecodeInputPointerUpBytes(bin)),
    "InputKeyDown" => Codecs.EncodeInputKeyDownBytes(Codecs.DecodeInputKeyDownBytes(bin)),
    "InputKeyUp" => Codecs.EncodeInputKeyUpBytes(Codecs.DecodeInputKeyUpBytes(bin)),
    "InputScroll" => Codecs.EncodeInputScrollBytes(Codecs.DecodeInputScrollBytes(bin)),
    "AssetRequest" => Codecs.EncodeAssetRequestBytes(Codecs.DecodeAssetRequestBytes(bin)),
    "AssetCancel" => Codecs.EncodeAssetCancelBytes(Codecs.DecodeAssetCancelBytes(bin)),
    "ViewportOpened" => Codecs.EncodeViewportOpenedBytes(Codecs.DecodeViewportOpenedBytes(bin)),
    "ViewportClosed" => Codecs.EncodeViewportClosedBytes(Codecs.DecodeViewportClosedBytes(bin)),
    "HostAttached" => Codecs.EncodeHostAttachedBytes(Codecs.DecodeHostAttachedBytes(bin)),
    "HostDetached" => Codecs.EncodeHostDetachedBytes(Codecs.DecodeHostDetachedBytes(bin)),
    "DocumentInstalled" => Codecs.EncodeDocumentInstalledBytes(Codecs.DecodeDocumentInstalledBytes(bin)),
    "DocumentDiscarded" => Codecs.EncodeDocumentDiscardedBytes(Codecs.DecodeDocumentDiscardedBytes(bin)),
    "Navigated" => Codecs.EncodeNavigatedBytes(Codecs.DecodeNavigatedBytes(bin)),
    "LoadStateChanged" => Codecs.EncodeLoadStateChangedBytes(Codecs.DecodeLoadStateChangedBytes(bin)),
    "PromptRequested" => Codecs.EncodePromptRequestedBytes(Codecs.DecodePromptRequestedBytes(bin)),
    "PromptAbandoned" => Codecs.EncodePromptAbandonedBytes(Codecs.DecodePromptAbandonedBytes(bin)),
    "Patch" => Codecs.EncodePatchBytes(Codecs.DecodePatchBytes(bin)),
    "Snapshotted" => Codecs.EncodeSnapshottedBytes(Codecs.DecodeSnapshottedBytes(bin)),
    "AssetChunk" => Codecs.EncodeAssetChunkBytes(Codecs.DecodeAssetChunkBytes(bin)),
    "AssetEnd" => Codecs.EncodeAssetEndBytes(Codecs.DecodeAssetEndBytes(bin)),
    "AssetDenied" => Codecs.EncodeAssetDeniedBytes(Codecs.DecodeAssetDeniedBytes(bin)),
    "Fault" => Codecs.EncodeFaultBytes(Codecs.DecodeFaultBytes(bin)),
    "FreezeResult" => Codecs.EncodeFreezeResultBytes(Codecs.DecodeFreezeResultBytes(bin)),
    "StateCaptured" => Codecs.EncodeStateCapturedBytes(Codecs.DecodeStateCapturedBytes(bin)),
    "ProbeResult" => Codecs.EncodeProbeResultBytes(Codecs.DecodeProbeResultBytes(bin)),
    "Telemetry" => Codecs.EncodeTelemetryBytes(Codecs.DecodeTelemetryBytes(bin)),
    _ => null
};
