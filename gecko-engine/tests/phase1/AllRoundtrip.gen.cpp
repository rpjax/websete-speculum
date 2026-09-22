// GENERATED — DO NOT EDIT
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>
#include "domain/wire/Cursor.hpp"
#include "domain/wire/gen/SpeculumWire.gen.hpp"
using namespace speculum::wire;
static int fails = 0;
#define CHECK(c,m) do{ if(!(c)){ std::fprintf(stderr,"FAIL %s\n",m); ++fails; } }while(0)
static std::vector<uint8_t> slurp(const std::string& p){
  std::ifstream in(p, std::ios::binary);
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)), {});
}
int run_all_roundtrips(const std::string& goldenDir) {
  CHECK(kMessageCount == 48, "message count");
  std::vector<uint8_t> buf(1 << 20);
  { // FreezeAll
    auto golden = slurp(goldenDir + "/FreezeAll.bin");
    FreezeAll msg{};
    // numeric timeoutMs=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_FreezeAll(r, msg) && r.ok(), "decode FreezeAll");
    Writer w(buf);
    CHECK(encode_FreezeAll(w, msg), "encode FreezeAll");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes FreezeAll");
  }
  { // CaptureState
    auto golden = slurp(goldenDir + "/CaptureState.bin");
    CaptureState msg{};
    // numeric token=2684354561 applied after decode check
    // numeric kind=3 applied after decode check
    Reader r(golden);
    CHECK(decode_CaptureState(r, msg) && r.ok(), "decode CaptureState");
    Writer w(buf);
    CHECK(encode_CaptureState(w, msg), "encode CaptureState");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes CaptureState");
  }
  { // ThawAll
    auto golden = slurp(goldenDir + "/ThawAll.bin");
    ThawAll msg{};
    // numeric token=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_ThawAll(r, msg) && r.ok(), "decode ThawAll");
    Writer w(buf);
    CHECK(encode_ThawAll(w, msg), "encode ThawAll");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ThawAll");
  }
  { // Probe
    auto golden = slurp(goldenDir + "/Probe.bin");
    Probe msg{};
    // numeric id=2 applied after decode check
    // list/bytes args
    Reader r(golden);
    CHECK(decode_Probe(r, msg) && r.ok(), "decode Probe");
    Writer w(buf);
    CHECK(encode_Probe(w, msg), "encode Probe");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Probe");
  }
  { // Shutdown
    auto golden = slurp(goldenDir + "/Shutdown.bin");
    Shutdown msg{};
    Reader r(golden);
    CHECK(decode_Shutdown(r, msg) && r.ok(), "decode Shutdown");
    Writer w(buf);
    CHECK(encode_Shutdown(w, msg), "encode Shutdown");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Shutdown");
  }
  { // ViewportOpen
    auto golden = slurp(goldenDir + "/ViewportOpen.bin");
    ViewportOpen msg{};
    // struct extent
    Reader r(golden);
    CHECK(decode_ViewportOpen(r, msg) && r.ok(), "decode ViewportOpen");
    Writer w(buf);
    CHECK(encode_ViewportOpen(w, msg), "encode ViewportOpen");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ViewportOpen");
  }
  { // ViewportClose
    auto golden = slurp(goldenDir + "/ViewportClose.bin");
    ViewportClose msg{};
    Reader r(golden);
    CHECK(decode_ViewportClose(r, msg) && r.ok(), "decode ViewportClose");
    Writer w(buf);
    CHECK(encode_ViewportClose(w, msg), "encode ViewportClose");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ViewportClose");
  }
  { // ViewportResize
    auto golden = slurp(goldenDir + "/ViewportResize.bin");
    ViewportResize msg{};
    // struct extent
    Reader r(golden);
    CHECK(decode_ViewportResize(r, msg) && r.ok(), "decode ViewportResize");
    Writer w(buf);
    CHECK(encode_ViewportResize(w, msg), "encode ViewportResize");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ViewportResize");
  }
  { // Navigate
    auto golden = slurp(goldenDir + "/Navigate.bin");
    Navigate msg{};
    // str field url set via decode path
    Reader r(golden);
    CHECK(decode_Navigate(r, msg) && r.ok(), "decode Navigate");
    Writer w(buf);
    CHECK(encode_Navigate(w, msg), "encode Navigate");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Navigate");
  }
  { // Reload
    auto golden = slurp(goldenDir + "/Reload.bin");
    Reload msg{};
    Reader r(golden);
    CHECK(decode_Reload(r, msg) && r.ok(), "decode Reload");
    Writer w(buf);
    CHECK(encode_Reload(w, msg), "encode Reload");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Reload");
  }
  { // StopLoad
    auto golden = slurp(goldenDir + "/StopLoad.bin");
    StopLoad msg{};
    Reader r(golden);
    CHECK(decode_StopLoad(r, msg) && r.ok(), "decode StopLoad");
    Writer w(buf);
    CHECK(encode_StopLoad(w, msg), "encode StopLoad");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes StopLoad");
  }
  { // HistoryGo
    auto golden = slurp(goldenDir + "/HistoryGo.bin");
    HistoryGo msg{};
    // numeric delta=-1001 applied after decode check
    Reader r(golden);
    CHECK(decode_HistoryGo(r, msg) && r.ok(), "decode HistoryGo");
    Writer w(buf);
    CHECK(encode_HistoryGo(w, msg), "encode HistoryGo");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes HistoryGo");
  }
  { // HostResize
    auto golden = slurp(goldenDir + "/HostResize.bin");
    HostResize msg{};
    // struct extent
    Reader r(golden);
    CHECK(decode_HostResize(r, msg) && r.ok(), "decode HostResize");
    Writer w(buf);
    CHECK(encode_HostResize(w, msg), "encode HostResize");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes HostResize");
  }
  { // Resync
    auto golden = slurp(goldenDir + "/Resync.bin");
    Resync msg{};
    // numeric force=1 applied after decode check
    // numeric scope=0 applied after decode check
    Reader r(golden);
    CHECK(decode_Resync(r, msg) && r.ok(), "decode Resync");
    Writer w(buf);
    CHECK(encode_Resync(w, msg), "encode Resync");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Resync");
  }
  { // ClocksHalt
    auto golden = slurp(goldenDir + "/ClocksHalt.bin");
    ClocksHalt msg{};
    // numeric scope=1 applied after decode check
    Reader r(golden);
    CHECK(decode_ClocksHalt(r, msg) && r.ok(), "decode ClocksHalt");
    Writer w(buf);
    CHECK(encode_ClocksHalt(w, msg), "encode ClocksHalt");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ClocksHalt");
  }
  { // ClocksResume
    auto golden = slurp(goldenDir + "/ClocksResume.bin");
    ClocksResume msg{};
    // numeric scope=1 applied after decode check
    Reader r(golden);
    CHECK(decode_ClocksResume(r, msg) && r.ok(), "decode ClocksResume");
    Writer w(buf);
    CHECK(encode_ClocksResume(w, msg), "encode ClocksResume");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ClocksResume");
  }
  { // PromptRespond
    auto golden = slurp(goldenDir + "/PromptRespond.bin");
    PromptRespond msg{};
    // numeric request=2684354561 applied after decode check
    // list/bytes answer
    Reader r(golden);
    CHECK(decode_PromptRespond(r, msg) && r.ok(), "decode PromptRespond");
    Writer w(buf);
    CHECK(encode_PromptRespond(w, msg), "encode PromptRespond");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes PromptRespond");
  }
  { // Flush
    auto golden = slurp(goldenDir + "/Flush.bin");
    Flush msg{};
    // numeric generation=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_Flush(r, msg) && r.ok(), "decode Flush");
    Writer w(buf);
    CHECK(encode_Flush(w, msg), "encode Flush");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Flush");
  }
  { // Snapshot
    auto golden = slurp(goldenDir + "/Snapshot.bin");
    Snapshot msg{};
    // numeric generation=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_Snapshot(r, msg) && r.ok(), "decode Snapshot");
    Writer w(buf);
    CHECK(encode_Snapshot(w, msg), "encode Snapshot");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Snapshot");
  }
  { // InputPointerDown
    auto golden = slurp(goldenDir + "/InputPointerDown.bin");
    InputPointerDown msg{};
    // numeric generation=2684354561 applied after decode check
    // numeric node=2684354562 applied after decode check
    // numeric localX=4099 applied after decode check
    // numeric localY=4100 applied after decode check
    // numeric button=2 applied after decode check
    Reader r(golden);
    CHECK(decode_InputPointerDown(r, msg) && r.ok(), "decode InputPointerDown");
    Writer w(buf);
    CHECK(encode_InputPointerDown(w, msg), "encode InputPointerDown");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes InputPointerDown");
  }
  { // InputPointerUp
    auto golden = slurp(goldenDir + "/InputPointerUp.bin");
    InputPointerUp msg{};
    // numeric generation=2684354561 applied after decode check
    // numeric node=2684354562 applied after decode check
    // numeric localX=4099 applied after decode check
    // numeric localY=4100 applied after decode check
    // numeric button=2 applied after decode check
    Reader r(golden);
    CHECK(decode_InputPointerUp(r, msg) && r.ok(), "decode InputPointerUp");
    Writer w(buf);
    CHECK(encode_InputPointerUp(w, msg), "encode InputPointerUp");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes InputPointerUp");
  }
  { // InputKeyDown
    auto golden = slurp(goldenDir + "/InputKeyDown.bin");
    InputKeyDown msg{};
    // struct stroke
    Reader r(golden);
    CHECK(decode_InputKeyDown(r, msg) && r.ok(), "decode InputKeyDown");
    Writer w(buf);
    CHECK(encode_InputKeyDown(w, msg), "encode InputKeyDown");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes InputKeyDown");
  }
  { // InputKeyUp
    auto golden = slurp(goldenDir + "/InputKeyUp.bin");
    InputKeyUp msg{};
    // struct stroke
    Reader r(golden);
    CHECK(decode_InputKeyUp(r, msg) && r.ok(), "decode InputKeyUp");
    Writer w(buf);
    CHECK(encode_InputKeyUp(w, msg), "encode InputKeyUp");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes InputKeyUp");
  }
  { // InputScroll
    auto golden = slurp(goldenDir + "/InputScroll.bin");
    InputScroll msg{};
    // numeric generation=2684354561 applied after decode check
    // numeric node=2684354562 applied after decode check
    // numeric fracX=4099 applied after decode check
    // numeric fracY=4100 applied after decode check
    Reader r(golden);
    CHECK(decode_InputScroll(r, msg) && r.ok(), "decode InputScroll");
    Writer w(buf);
    CHECK(encode_InputScroll(w, msg), "encode InputScroll");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes InputScroll");
  }
  { // AssetRequest
    auto golden = slurp(goldenDir + "/AssetRequest.bin");
    AssetRequest msg{};
    // numeric generation=2684354561 applied after decode check
    // numeric stream=2684354562 applied after decode check
    // str field url set via decode path
    Reader r(golden);
    CHECK(decode_AssetRequest(r, msg) && r.ok(), "decode AssetRequest");
    Writer w(buf);
    CHECK(encode_AssetRequest(w, msg), "encode AssetRequest");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes AssetRequest");
  }
  { // AssetCancel
    auto golden = slurp(goldenDir + "/AssetCancel.bin");
    AssetCancel msg{};
    // numeric stream=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_AssetCancel(r, msg) && r.ok(), "decode AssetCancel");
    Writer w(buf);
    CHECK(encode_AssetCancel(w, msg), "encode AssetCancel");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes AssetCancel");
  }
  { // Ready
    auto golden = slurp(goldenDir + "/Ready.bin");
    Ready msg{};
    Reader r(golden);
    CHECK(decode_Ready(r, msg) && r.ok(), "decode Ready");
    Writer w(buf);
    CHECK(encode_Ready(w, msg), "encode Ready");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Ready");
  }
  { // Heartbeat
    auto golden = slurp(goldenDir + "/Heartbeat.bin");
    Heartbeat msg{};
    // numeric monotonicMs=12682136550675316737 applied after decode check
    Reader r(golden);
    CHECK(decode_Heartbeat(r, msg) && r.ok(), "decode Heartbeat");
    Writer w(buf);
    CHECK(encode_Heartbeat(w, msg), "encode Heartbeat");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Heartbeat");
  }
  { // ViewportOpened
    auto golden = slurp(goldenDir + "/ViewportOpened.bin");
    ViewportOpened msg{};
    // numeric rootHost=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_ViewportOpened(r, msg) && r.ok(), "decode ViewportOpened");
    Writer w(buf);
    CHECK(encode_ViewportOpened(w, msg), "encode ViewportOpened");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ViewportOpened");
  }
  { // ViewportClosed
    auto golden = slurp(goldenDir + "/ViewportClosed.bin");
    ViewportClosed msg{};
    Reader r(golden);
    CHECK(decode_ViewportClosed(r, msg) && r.ok(), "decode ViewportClosed");
    Writer w(buf);
    CHECK(encode_ViewportClosed(w, msg), "encode ViewportClosed");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ViewportClosed");
  }
  { // HostAttached
    auto golden = slurp(goldenDir + "/HostAttached.bin");
    HostAttached msg{};
    // numeric parent=2684354561 applied after decode check
    // numeric viewport=2684354562 applied after decode check
    Reader r(golden);
    CHECK(decode_HostAttached(r, msg) && r.ok(), "decode HostAttached");
    Writer w(buf);
    CHECK(encode_HostAttached(w, msg), "encode HostAttached");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes HostAttached");
  }
  { // HostDetached
    auto golden = slurp(goldenDir + "/HostDetached.bin");
    HostDetached msg{};
    Reader r(golden);
    CHECK(decode_HostDetached(r, msg) && r.ok(), "decode HostDetached");
    Writer w(buf);
    CHECK(encode_HostDetached(w, msg), "encode HostDetached");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes HostDetached");
  }
  { // DocumentInstalled
    auto golden = slurp(goldenDir + "/DocumentInstalled.bin");
    DocumentInstalled msg{};
    // numeric generation=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_DocumentInstalled(r, msg) && r.ok(), "decode DocumentInstalled");
    Writer w(buf);
    CHECK(encode_DocumentInstalled(w, msg), "encode DocumentInstalled");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes DocumentInstalled");
  }
  { // DocumentDiscarded
    auto golden = slurp(goldenDir + "/DocumentDiscarded.bin");
    DocumentDiscarded msg{};
    // numeric generation=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_DocumentDiscarded(r, msg) && r.ok(), "decode DocumentDiscarded");
    Writer w(buf);
    CHECK(encode_DocumentDiscarded(w, msg), "encode DocumentDiscarded");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes DocumentDiscarded");
  }
  { // Navigated
    auto golden = slurp(goldenDir + "/Navigated.bin");
    Navigated msg{};
    // str field url set via decode path
    Reader r(golden);
    CHECK(decode_Navigated(r, msg) && r.ok(), "decode Navigated");
    Writer w(buf);
    CHECK(encode_Navigated(w, msg), "encode Navigated");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Navigated");
  }
  { // LoadStateChanged
    auto golden = slurp(goldenDir + "/LoadStateChanged.bin");
    LoadStateChanged msg{};
    // numeric state=2 applied after decode check
    Reader r(golden);
    CHECK(decode_LoadStateChanged(r, msg) && r.ok(), "decode LoadStateChanged");
    Writer w(buf);
    CHECK(encode_LoadStateChanged(w, msg), "encode LoadStateChanged");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes LoadStateChanged");
  }
  { // PromptRequested
    auto golden = slurp(goldenDir + "/PromptRequested.bin");
    PromptRequested msg{};
    // numeric request=2684354561 applied after decode check
    // numeric kind=3 applied after decode check
    // list/bytes description
    Reader r(golden);
    CHECK(decode_PromptRequested(r, msg) && r.ok(), "decode PromptRequested");
    Writer w(buf);
    CHECK(encode_PromptRequested(w, msg), "encode PromptRequested");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes PromptRequested");
  }
  { // PromptAbandoned
    auto golden = slurp(goldenDir + "/PromptAbandoned.bin");
    PromptAbandoned msg{};
    // numeric request=2684354561 applied after decode check
    Reader r(golden);
    CHECK(decode_PromptAbandoned(r, msg) && r.ok(), "decode PromptAbandoned");
    Writer w(buf);
    CHECK(encode_PromptAbandoned(w, msg), "encode PromptAbandoned");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes PromptAbandoned");
  }
  { // Patch
    auto golden = slurp(goldenDir + "/Patch.bin");
    Patch msg{};
    // numeric generation=2684354561 applied after decode check
    // numeric sequence=2684354562 applied after decode check
    // numeric flags=4099 applied after decode check
    // numeric builtAt=2684354564 applied after decode check
    // list/bytes metrics
    // list/bytes deltas
    Reader r(golden);
    CHECK(decode_Patch(r, msg) && r.ok(), "decode Patch");
    Writer w(buf);
    CHECK(encode_Patch(w, msg), "encode Patch");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Patch");
  }
  { // Snapshotted
    auto golden = slurp(goldenDir + "/Snapshotted.bin");
    Snapshotted msg{};
    // numeric generation=2684354561 applied after decode check
    // numeric sequence=2684354562 applied after decode check
    // numeric digest=12682136550675316739 applied after decode check
    // list/bytes dump
    Reader r(golden);
    CHECK(decode_Snapshotted(r, msg) && r.ok(), "decode Snapshotted");
    Writer w(buf);
    CHECK(encode_Snapshotted(w, msg), "encode Snapshotted");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Snapshotted");
  }
  { // AssetChunk
    auto golden = slurp(goldenDir + "/AssetChunk.bin");
    AssetChunk msg{};
    // numeric stream=2684354561 applied after decode check
    // numeric offset=12682136550675316738 applied after decode check
    // list/bytes data
    Reader r(golden);
    CHECK(decode_AssetChunk(r, msg) && r.ok(), "decode AssetChunk");
    Writer w(buf);
    CHECK(encode_AssetChunk(w, msg), "encode AssetChunk");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes AssetChunk");
  }
  { // AssetEnd
    auto golden = slurp(goldenDir + "/AssetEnd.bin");
    AssetEnd msg{};
    // numeric stream=2684354561 applied after decode check
    // numeric total=12682136550675316738 applied after decode check
    Reader r(golden);
    CHECK(decode_AssetEnd(r, msg) && r.ok(), "decode AssetEnd");
    Writer w(buf);
    CHECK(encode_AssetEnd(w, msg), "encode AssetEnd");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes AssetEnd");
  }
  { // AssetDenied
    auto golden = slurp(goldenDir + "/AssetDenied.bin");
    AssetDenied msg{};
    // numeric stream=2684354561 applied after decode check
    // numeric code=3 applied after decode check
    Reader r(golden);
    CHECK(decode_AssetDenied(r, msg) && r.ok(), "decode AssetDenied");
    Writer w(buf);
    CHECK(encode_AssetDenied(w, msg), "encode AssetDenied");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes AssetDenied");
  }
  { // Fault
    auto golden = slurp(goldenDir + "/Fault.bin");
    Fault msg{};
    // numeric code=2 applied after decode check
    // numeric flags=2684354562 applied after decode check
    // str field origin set via decode path
    // str field message set via decode path
    // list/bytes data
    Reader r(golden);
    CHECK(decode_Fault(r, msg) && r.ok(), "decode Fault");
    Writer w(buf);
    CHECK(encode_Fault(w, msg), "encode Fault");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Fault");
  }
  { // FreezeResult
    auto golden = slurp(goldenDir + "/FreezeResult.bin");
    FreezeResult msg{};
    // numeric token=2684354561 applied after decode check
    // numeric frozen=2684354562 applied after decode check
    // numeric expected=2684354563 applied after decode check
    Reader r(golden);
    CHECK(decode_FreezeResult(r, msg) && r.ok(), "decode FreezeResult");
    Writer w(buf);
    CHECK(encode_FreezeResult(w, msg), "encode FreezeResult");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes FreezeResult");
  }
  { // StateCaptured
    auto golden = slurp(goldenDir + "/StateCaptured.bin");
    StateCaptured msg{};
    // numeric token=2684354561 applied after decode check
    // numeric host=2684354562 applied after decode check
    // numeric generation=2684354563 applied after decode check
    // numeric kind=2 applied after decode check
    // numeric digest=12682136550675316741 applied after decode check
    // list/bytes image
    Reader r(golden);
    CHECK(decode_StateCaptured(r, msg) && r.ok(), "decode StateCaptured");
    Writer w(buf);
    CHECK(encode_StateCaptured(w, msg), "encode StateCaptured");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes StateCaptured");
  }
  { // ProbeResult
    auto golden = slurp(goldenDir + "/ProbeResult.bin");
    ProbeResult msg{};
    // numeric id=2 applied after decode check
    msg.enabled = true;
    // list/bytes payload
    Reader r(golden);
    CHECK(decode_ProbeResult(r, msg) && r.ok(), "decode ProbeResult");
    Writer w(buf);
    CHECK(encode_ProbeResult(w, msg), "encode ProbeResult");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes ProbeResult");
  }
  { // Telemetry
    auto golden = slurp(goldenDir + "/Telemetry.bin");
    Telemetry msg{};
    // numeric id=2 applied after decode check
    // list/bytes payload
    Reader r(golden);
    CHECK(decode_Telemetry(r, msg) && r.ok(), "decode Telemetry");
    Writer w(buf);
    CHECK(encode_Telemetry(w, msg), "encode Telemetry");
    CHECK(w.length() == golden.size() && std::equal(w.written().begin(), w.written().end(), golden.begin()), "roundtrip bytes Telemetry");
  }
  return fails;
}
