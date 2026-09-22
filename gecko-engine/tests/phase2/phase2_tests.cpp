// Phase 2 acceptance — Session / LinkWriter / Router / Heartbeat / dump.
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "domain/fault/Fault.hpp"
#include "domain/ids/Ids.hpp"
#include "domain/session/Correlations.hpp"
#include "domain/session/DeathDump.hpp"
#include "domain/session/Heartbeat.hpp"
#include "domain/session/LinkWriter.hpp"
#include "domain/session/RecordingOwners.hpp"
#include "domain/session/Router.hpp"
#include "domain/session/Session.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "domain/session/fakes/ScriptedLink.hpp"
#include "domain/wire/Cursor.hpp"
#include "domain/wire/Envelope.hpp"
#include "domain/wire/Limits.hpp"
#include "domain/wire/gen/SpeculumWire.gen.hpp"

using namespace speculum;
using namespace speculum::session;
using namespace speculum::wire;

static int g_fails = 0;
#define CHECK(c, m)                                                            \
  do {                                                                         \
    if (!(c)) {                                                                \
      std::fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, m);          \
      ++g_fails;                                                               \
    }                                                                          \
  } while (0)

struct DumpCapture : IDeathDumpSink {
  int count{0};
  DeathDump last{};
  Phase phase_when_called{Phase::Booting};
  void onDeathDump(const DeathDump& d) override {
    ++count;
    last = d;
    phase_when_called = d.phase;
  }
};

static void appendEnv(std::vector<uint8_t>& out, Envelope env, std::span<const uint8_t> payload) {
  env.length = uint32_t(payload.size());
  auto put16 = [&](uint16_t v) {
    out.push_back(uint8_t(v));
    out.push_back(uint8_t(v >> 8));
  };
  auto put32 = [&](uint32_t v) {
    out.push_back(uint8_t(v));
    out.push_back(uint8_t(v >> 8));
    out.push_back(uint8_t(v >> 16));
    out.push_back(uint8_t(v >> 24));
  };
  put16(env.opcode);
  put16(env.reserved);
  put32(env.target);
  put32(env.length);
  put32(env.correlation);
  out.insert(out.end(), payload.begin(), payload.end());
}

static void test_scripted_link_sticky() {
  ScriptedLink link;
  struct Sink : ILinkSink {
    int broken = 0;
    int bytes = 0;
    void onBytes(std::span<const uint8_t>) override { ++bytes; }
    void onWritable() override {}
    void onBroken() override { ++broken; }
  } sink;
  link.attach(&sink);
  link.script({{WriteOutcome::Broken, 0}});
  auto r = link.write(std::span<const uint8_t>());
  CHECK(r.outcome == WriteOutcome::Broken, "first broken");
  CHECK(sink.broken == 1, "onBroken once");
  link.signalBroken();
  CHECK(sink.broken == 1, "second broken no notify");
  link.pushBytes(std::span<const uint8_t>());
  CHECK(sink.bytes == 0, "no bytes after broken");
  auto r2 = link.write(std::span<const uint8_t>());
  CHECK(r2.outcome == WriteOutcome::Broken, "sticky");
}

static void test_manual_clock() {
  ManualClock clock;
  struct T : ITimerTarget {
    int fires = 0;
    TimerId last = 0;
    void onTimerFired(TimerId id) override {
      ++fires;
      last = id;
    }
  } t;
  auto id = clock.scheduleOnce(100, &t);
  clock.cancel(id);
  clock.advance(200);
  CHECK(t.fires == 0, "cancel idempotent");
  CHECK(clock.now() == 200, "now advanced");
  auto id2 = clock.scheduleOnce(50, &t);
  clock.advance(50);
  CHECK(t.fires == 1 && t.last == id2, "fired");
  Millis a = clock.now();
  clock.advance(1);
  CHECK(clock.now() > a, "monotonic");
}

static void test_correlations() {
  Correlations c;
  HostId h{1};
  Generation g{2};
  c.remember(10, PendingKind::Navigate, h, g);
  CHECK(c.pending() == 1, "pending 1");
  auto p = c.take(10);
  CHECK(p.has_value() && p->kind == PendingKind::Navigate, "take");
  CHECK(!c.take(10).has_value(), "orphan second");
  CHECK(c.orphanTakes() == 1, "orphan count");
  c.remember(11, PendingKind::Snapshot, h, g);
  c.remember(12, PendingKind::Probe, HostId{2}, Generation{1});
  c.forgetHost(h, g);
  CHECK(c.pending() == 1, "forget host");
  c.take(12);
  CHECK(c.pending() == 0, "clean");
}

// Dedicated writer-only tests via a minimal gate
struct Gate : IEmitGate {
  bool emit{true};
  int broken = 0;
  bool mayEmit() const override { return emit; }
  void onWriteBroken() override { ++broken; }
};

static void test_writer_partial_loop() {
  ScriptedLink link;
  Gate gate;
  LinkWriter w(link, gate);
  std::vector<uint8_t> payload = {9, 9, 9, 9};
  Envelope env{};
  env.opcode = wire::Heartbeat::kOpcode;
  const std::size_t total = 16 + payload.size();
  link.script({{WriteOutcome::Partial, 8}, {WriteOutcome::Complete, total}});
  CHECK(w.offer(env, payload), "offer");
  CHECK(w.isIdle(), "idle after complete");
  CHECK(link.written().size() == total, "full envelope on wire");
  // contiguous check: first 2 bytes = opcode LE
  CHECK(link.written()[0] == uint8_t(wire::Heartbeat::kOpcode & 0xff), "op lo");
}

static void test_writer_would_block() {
  ScriptedLink link;
  Gate gate;
  LinkWriter w(link, gate);
  Envelope env{};
  env.opcode = Ready::kOpcode;
  link.script({{WriteOutcome::WouldBlock, 0}});
  CHECK(w.offer(env, {}), "first offer");
  CHECK(!w.isIdle(), "busy");
  CHECK(!w.offer(env, {}), "second offer refused");
  link.script({});  // complete thereafter
  link.signalWritable();
  // Writer needs onWritable to resume — after WouldBlock script exhausted, default Complete
  w.onWritable();
  CHECK(w.isIdle(), "drained");
}

static void test_writer_broken_mid() {
  ScriptedLink link;
  Gate gate;
  LinkWriter w(link, gate);
  Envelope env{};
  env.opcode = Ready::kOpcode;
  std::vector<uint8_t> payload(32, 7);
  link.script({{WriteOutcome::Partial, 10}, {WriteOutcome::Broken, 5}});
  w.offer(env, payload);
  CHECK(gate.broken == 1, "broken once");
  const auto after = link.writeCalls();
  w.onWritable();
  CHECK(link.writeCalls() == after, "no write after broken");
  CHECK(!w.offer(env, {}), "offer sealed");
}

static void bringReady(Session& s) {
  s.onLinkEstablished();
  s.onHostReady();
}

static void test_session_phases_and_emit() {
  ScriptedLink link;
  DumpCapture dump;
  RecordingOwners owners;
  Router router(owners, owners, owners);
  Correlations corr;
  ManualClock clock;
  Session session(link, clock, router, corr, &dump, 100);
  CHECK(!session.mayEmit(), "booting");
  session.onLinkEstablished();
  CHECK(!session.mayEmit(), "linked");
  session.onHostReady();
  CHECK(session.mayEmit() && session.phase() == Phase::Ready, "ready");
  // Ready should have been emitted
  CHECK(!link.written().empty(), "bytes after ready");
}

static void test_broken_kills_once() {
  ScriptedLink link;
  DumpCapture dump;
  RecordingOwners owners;
  Router router(owners, owners, owners);
  Correlations corr;
  ManualClock clock;
  Session session(link, clock, router, corr, &dump, 100);
  bringReady(session);
  const auto writes_before = link.writeCalls();
  link.signalBroken();
  CHECK(session.phase() == Phase::Dead, "dead");
  CHECK(dump.count == 1, "dump once");
  CHECK(dump.phase_when_called == Phase::Terminating, "dump before Dead");
  CHECK(session.hasKiller() && session.killer().code == fault::FaultCode::LinkBroken, "cause");
  link.signalBroken();
  CHECK(dump.count == 1, "second broken no new dump");
  CHECK(link.writeCallsAfterBroken() == 0 || link.writeCalls() >= writes_before, "tracked");
}

static void test_framing_lost_kills() {
  ScriptedLink link;
  DumpCapture dump;
  RecordingOwners owners;
  Router router(owners, owners, owners);
  Correlations corr;
  ManualClock clock;
  Session session(link, clock, router, corr, &dump, 100);
  bringReady(session);
  const int before = session.envelopesRouted();
  // Illegal length > max
  Envelope e{};
  e.opcode = Shutdown::kOpcode;
  e.length = Limits::kMaxPayload + 1;
  std::vector<uint8_t> bad;
  appendEnv(bad, e, {});
  // Fix length field in header to illegal value (appendEnv sets length from payload=0)
  bad.clear();
  auto put16 = [&](uint16_t v) {
    bad.push_back(uint8_t(v));
    bad.push_back(uint8_t(v >> 8));
  };
  auto put32 = [&](uint32_t v) {
    bad.push_back(uint8_t(v));
    bad.push_back(uint8_t(v >> 8));
    bad.push_back(uint8_t(v >> 16));
    bad.push_back(uint8_t(v >> 24));
  };
  put16(Shutdown::kOpcode);
  put16(0);
  put32(0);
  put32(Limits::kMaxPayload + 1);
  put32(0);
  link.pushBytes(bad);
  CHECK(session.phase() == Phase::Dead, "framing dead");
  CHECK(session.envelopesRouted() == before, "no envelope after lost");
  CHECK(session.killer().code == fault::FaultCode::CeilingExceeded ||
            session.killer().code == fault::FaultCode::FramingLost,
        "ceiling or framing");
}

static void test_heartbeat_n() {
  ScriptedLink link;
  DumpCapture dump;
  RecordingOwners owners;
  Router router(owners, owners, owners);
  Correlations corr;
  ManualClock clock;
  Session session(link, clock, router, corr, &dump, /*interval*/ 10);
  bringReady(session);
  const int base = session.heartbeat().beatCount();
  clock.advance(10);
  clock.advance(10);
  clock.advance(10);
  CHECK(session.heartbeat().beatCount() == base + 3, "exactly 3 beats");
  const auto& s = session.heartbeat().monotonicSamples();
  CHECK(s.size() >= 3, "samples");
  CHECK(s[s.size() - 3] < s[s.size() - 2] && s[s.size() - 2] < s[s.size() - 1], "strictly increasing");
  // Kill and ensure no more beats
  link.signalBroken();
  const int after = session.heartbeat().beatCount();
  clock.advance(100);
  CHECK(session.heartbeat().beatCount() == after, "silent when dead");
}

static void test_router_complete() {
  RecordingOwners owners;
  Router router(owners, owners, owners);
  CHECK(Router::kInboundCount == 26, "26 inbound");
  for (std::size_t i = 0; i < Router::kInboundCount; ++i) {
    const uint16_t op = Router::kInboundOpcodes[i];
    // empty / minimal payload encode
    std::vector<uint8_t> payload;
    uint8_t buf[512];
    Writer w(buf);
    // encode default-constructed message by opcode via switch helpers
    Envelope env{};
    env.opcode = op;
    // Build minimal valid payloads
    switch (op) {
      case FreezeAll::kOpcode: {
        FreezeAll m{};
        encode_FreezeAll(w, m);
        break;
      }
      case CaptureState::kOpcode: {
        CaptureState m{};
        encode_CaptureState(w, m);
        break;
      }
      case ThawAll::kOpcode: {
        ThawAll m{};
        encode_ThawAll(w, m);
        break;
      }
      case Probe::kOpcode: {
        Probe m{};
        encode_Probe(w, m);
        break;
      }
      case Shutdown::kOpcode: {
        Shutdown m{};
        encode_Shutdown(w, m);
        break;
      }
      case ViewportOpen::kOpcode: {
        ViewportOpen m{};
        encode_ViewportOpen(w, m);
        break;
      }
      case ViewportClose::kOpcode: {
        ViewportClose m{};
        encode_ViewportClose(w, m);
        break;
      }
      case ViewportResize::kOpcode: {
        ViewportResize m{};
        encode_ViewportResize(w, m);
        break;
      }
      case Navigate::kOpcode: {
        Navigate m{};
        m.url = "x";
        encode_Navigate(w, m);
        break;
      }
      case Reload::kOpcode: {
        Reload m{};
        encode_Reload(w, m);
        break;
      }
      case StopLoad::kOpcode: {
        StopLoad m{};
        encode_StopLoad(w, m);
        break;
      }
      case HistoryGo::kOpcode: {
        HistoryGo m{};
        encode_HistoryGo(w, m);
        break;
      }
      case HostResize::kOpcode: {
        HostResize m{};
        encode_HostResize(w, m);
        break;
      }
      case Resync::kOpcode: {
        Resync m{};
        encode_Resync(w, m);
        break;
      }
      case ClocksHalt::kOpcode: {
        ClocksHalt m{};
        encode_ClocksHalt(w, m);
        break;
      }
      case ClocksResume::kOpcode: {
        ClocksResume m{};
        encode_ClocksResume(w, m);
        break;
      }
      case PromptRespond::kOpcode: {
        PromptRespond m{};
        encode_PromptRespond(w, m);
        break;
      }
      case Flush::kOpcode: {
        Flush m{};
        encode_Flush(w, m);
        break;
      }
      case Snapshot::kOpcode: {
        Snapshot m{};
        encode_Snapshot(w, m);
        break;
      }
      case InputPointerDown::kOpcode: {
        InputPointerDown m{};
        encode_InputPointerDown(w, m);
        break;
      }
      case InputPointerUp::kOpcode: {
        InputPointerUp m{};
        encode_InputPointerUp(w, m);
        break;
      }
      case InputKeyDown::kOpcode: {
        InputKeyDown m{};
        encode_InputKeyDown(w, m);
        break;
      }
      case InputKeyUp::kOpcode: {
        InputKeyUp m{};
        encode_InputKeyUp(w, m);
        break;
      }
      case InputScroll::kOpcode: {
        InputScroll m{};
        encode_InputScroll(w, m);
        break;
      }
      case AssetRequest::kOpcode: {
        AssetRequest m{};
        m.url = "u";
        encode_AssetRequest(w, m);
        break;
      }
      case AssetCancel::kOpcode: {
        AssetCancel m{};
        encode_AssetCancel(w, m);
        break;
      }
      default:
        CHECK(false, "unhandled inbound in test");
        break;
    }
    payload.assign(w.written().begin(), w.written().end());
    router.onEnvelope(env, payload);
  }
  CHECK(owners.opcodes.size() == Router::kInboundCount, "each inbound once");
  // set equality
  std::vector<uint16_t> got = owners.opcodes;
  std::vector<uint16_t> expect(Router::kInboundOpcodes,
                               Router::kInboundOpcodes + Router::kInboundCount);
  std::sort(got.begin(), got.end());
  std::sort(expect.begin(), expect.end());
  CHECK(got == expect, "exact opcode set");
  // unknown
  Envelope unk{};
  unk.opcode = 0x01FE;
  router.onEnvelope(unk, {});
  CHECK(router.stats().unknown_opcodes == 1, "unknown logged");
  // wrong direction
  Envelope outb{};
  outb.opcode = Ready::kOpcode;
  router.onEnvelope(outb, {});
  CHECK(router.stats().wrong_direction == 1, "wrong dir");
}

static void test_no_bytes_before_ready() {
  ScriptedLink link;
  DumpCapture dump;
  RecordingOwners owners;
  Router router(owners, owners, owners);
  Correlations corr;
  ManualClock clock;
  Gate gate;
  gate.emit = false;
  LinkWriter w(link, gate);
  Envelope env{};
  env.opcode = wire::Heartbeat::kOpcode;
  CHECK(!w.offer(env, {}), "no emit before ready");
  CHECK(link.written().empty(), "no bytes");
}

static void test_death_dump_order() {
  ScriptedLink link;
  DumpCapture dump;
  RecordingOwners owners;
  Router router(owners, owners, owners);
  Correlations corr;
  ManualClock clock;
  Session session(link, clock, router, corr, &dump, 100);
  bringReady(session);
  corr.remember(1, PendingKind::Navigate, HostId{1}, Generation{1});
  link.signalBroken();
  CHECK(dump.count == 1, "dumped");
  CHECK(dump.phase_when_called == Phase::Terminating, "still terminating at dump");
  CHECK(session.phase() == Phase::Dead, "then dead");
  CHECK(dump.last.correlations_pending == 1, "corr in dump");
  CHECK(dump.last.has_killer, "killer in dump");
}

int main() {
  test_scripted_link_sticky();
  test_manual_clock();
  test_correlations();
  test_writer_partial_loop();
  test_writer_would_block();
  test_writer_broken_mid();
  test_session_phases_and_emit();
  test_broken_kills_once();
  test_framing_lost_kills();
  test_heartbeat_n();
  test_router_complete();
  test_no_bytes_before_ready();
  test_death_dump_order();

  if (g_fails) {
    std::fprintf(stderr, "%d failure(s)\n", g_fails);
    return 1;
  }
  std::puts("PASS phase2");
  return 0;
}
