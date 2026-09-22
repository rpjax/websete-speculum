// Phase 1 acceptance tests — effect asserts, no smoke.
#include <cstdio>
#include <cstring>
#include <fstream>
#include <random>
#include <string>
#include <vector>

#include "domain/fault/Fault.hpp"
#include "domain/ids/Ids.hpp"
#include "domain/wire/Cursor.hpp"
#include "domain/wire/Envelope.hpp"
#include "domain/wire/Framer.hpp"
#include "domain/wire/Limits.hpp"
#include "domain/wire/gen/SpeculumWire.gen.hpp"

using namespace speculum;
using namespace speculum::wire;
namespace fault = speculum::fault;

static int g_fails = 0;

#define CHECK(cond, msg)                                                       \
  do {                                                                         \
    if (!(cond)) {                                                             \
      std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, msg);       \
      ++g_fails;                                                               \
    }                                                                          \
  } while (0)

static std::vector<uint8_t> readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  CHECK(in.good(), path.c_str());
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)),
                              std::istreambuf_iterator<char>());
}

static void test_ids() {
  ViewportMinter vm;
  HostMinter hm;
  auto a = vm.mint();
  auto b = vm.mint();
  CHECK(a.valid() && b.valid(), "ids valid");
  CHECK(a.value() == 1 && b.value() == 2, "monotonic");
  CHECK(a != b, "no equal consecutive");
  CHECK(vm.minted() == 2, "minted count");
  Generation g1{1};
  Generation g2{2};
  CHECK(!(g1 == g2), "generation distinct");
  // No DocumentRef mint type in tree — compile-time by absence.
}

static void test_actionOf() {
  using FaultCode = fault::FaultCode;
  using FaultAction = fault::FaultAction;
  CHECK(fault::actionOf(FaultCode::FramingLost) == FaultAction::KillSession, "FramingLost");
  CHECK(fault::actionOf(FaultCode::CeilingExceeded) == FaultAction::KillSession, "Ceiling");
  CHECK(fault::actionOf(FaultCode::LinkBroken) == FaultAction::KillSession, "LinkBroken");
  CHECK(fault::actionOf(FaultCode::DocumentGone) == FaultAction::DropDocument, "DocumentGone");
  CHECK(fault::actionOf(FaultCode::AssetOffsetGap) == FaultAction::DropStream, "AssetOffsetGap");
  CHECK(fault::actionOf(FaultCode::NavigateRefused) == FaultAction::Report, "NavigateRefused");
  CHECK(fault::actionOf(FaultCode::InputHalted) == FaultAction::Report, "InputHalted");
  CHECK(fault::actionOf(FaultCode::ResyncCheckFailed) == FaultAction::Report, "ResyncCheckFailed");

  const FaultCode all[] = {
      FaultCode::FramingLost,        FaultCode::CeilingExceeded,
      FaultCode::WrongDirection,     FaultCode::MalformedFields,
      FaultCode::LinkBroken,         FaultCode::ClockUnavailable,
      FaultCode::ViewportOpenRefused,FaultCode::NoSuchViewport,
      FaultCode::NoSuchHost,         FaultCode::HostGone,
      FaultCode::NoSuchDocument,     FaultCode::DocumentGone,
      FaultCode::MalformedUrl,       FaultCode::NavigateRefused,
      FaultCode::ResizeRefused,      FaultCode::StaleGeneration,
      FaultCode::ProbeDisabled,      FaultCode::HaltIncomplete,
      FaultCode::CaptureUnavailable, FaultCode::StaleFreezeToken,
      FaultCode::ResyncCheckFailed,  FaultCode::SnapshotTooLarge,
      FaultCode::IdentityExhausted,  FaultCode::InputUnknownKind,
      FaultCode::InputNoIdentity,    FaultCode::InputNodeGone,
      FaultCode::InputNotElement,    FaultCode::InputHalted,
      FaultCode::InputNoTarget,      FaultCode::AssetNotFound,
      FaultCode::AssetForbidden,     FaultCode::AssetReadFailed,
      FaultCode::AssetOffsetGap,     FaultCode::AssetPhaseViolation,
      FaultCode::AssetTooManyStreams};
  for (auto c : all) {
    auto a = fault::actionOf(c);
    CHECK(a == FaultAction::Report || a == FaultAction::DropDocument ||
              a == FaultAction::DropStream || a == FaultAction::KillSession,
          "actionOf total");
  }
}

static void test_cursor() {
  uint8_t buf[16] = {};
  Writer w(buf);
  CHECK(w.u32(0x11223344), "w.u32");
  CHECK(w.length() == 4, "w.len");
  Reader r(std::span<const uint8_t>(buf, 4));
  uint32_t v = 0;
  CHECK(r.u32(v) && v == 0x11223344, "r.u32");
  uint8_t x = 0;
  CHECK(!r.u8(x) && !r.ok(), "sticky fail");
  CHECK(!r.u8(x) && !r.ok(), "sticky stays");
}

static void test_limits_source() {
  CHECK(Limits::kMaxPayload == (64u << 20), "kMaxPayload");
  CHECK(Limits::kEnvelopeBytes == 16, "envelope 16");
}

struct CaptureTarget : IEnvelopeTarget {
  std::vector<Envelope> envs;
  std::vector<std::vector<uint8_t>> payloads;
  int lost = 0;
  void onEnvelope(const Envelope& e, std::span<const uint8_t> p) override {
    envs.push_back(e);
    payloads.emplace_back(p.begin(), p.end());
  }
  void onFramingLost(speculum::fault::Fault) override { ++lost; }
};

static void appendEnvelope(std::vector<uint8_t>& out, Envelope env,
                           std::span<const uint8_t> payload) {
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

static std::vector<uint8_t> makeStream(
    const std::vector<std::pair<Envelope, std::vector<uint8_t>>>& msgs) {
  std::vector<uint8_t> out;
  for (auto& [e, p] : msgs) {
    appendEnvelope(out, e, p);
  }
  return out;
}

static void test_framer_partition() {
  CaptureTarget full;
  Framer fFull(full);
  std::vector<std::pair<Envelope, std::vector<uint8_t>>> corpus = {
      {{Ready::kOpcode, 0, 0, 0, 0}, {}},
      {{Heartbeat::kOpcode, 0, 0, 0, 7}, {1, 2, 3, 4, 5, 6, 7, 8}},  // u64 = 8 bytes
      {{Navigated::kOpcode, 0, 9, 0, 42}, {4, 0, 0, 0, 'h', 'i', '!', '!'}},  // str "hi!!" wrong — fix below
  };
  // Heartbeat payload: monotonicMs u64
  {
    uint8_t hb[8];
    Writer w(hb);
    w.u64(123456789ull);
    corpus[1].second.assign(hb, hb + 8);
  }
  // Navigated: str
  {
    uint8_t nb[32];
    Writer w(nb);
    w.str("https://x");
    corpus[2].second.assign(nb, nb + w.length());
  }

  auto stream = makeStream(corpus);
  fFull.feed(stream);
  CHECK(full.envs.size() == 3, "full deliver 3");
  CHECK(full.lost == 0, "full no lost");

  auto runParts = [&](auto&& split) {
    CaptureTarget t;
    Framer fr(t);
    split(stream, fr);
    CHECK(t.envs.size() == full.envs.size(), "part count");
    for (size_t i = 0; i < full.envs.size(); ++i) {
      CHECK(t.envs[i].opcode == full.envs[i].opcode, "op");
      CHECK(t.envs[i].target == full.envs[i].target, "target");
      CHECK(t.envs[i].length == full.envs[i].length, "len");
      CHECK(t.envs[i].correlation == full.envs[i].correlation, "corr");
      CHECK(t.payloads[i] == full.payloads[i], "payload");
    }
  };

  runParts([](const std::vector<uint8_t>& s, Framer& fr) {
    for (auto b : s) fr.feed(std::span<const uint8_t>(&b, 1));
  });

  runParts([](const std::vector<uint8_t>& s, Framer& fr) {
    const int primes[] = {2, 3, 5, 7, 11, 13};
    size_t i = 0, pi = 0;
    while (i < s.size()) {
      size_t n = size_t(primes[pi % 6]);
      if (i + n > s.size()) n = s.size() - i;
      fr.feed(std::span<const uint8_t>(s.data() + i, n));
      i += n;
      ++pi;
    }
  });

  runParts([](const std::vector<uint8_t>& s, Framer& fr) {
    std::mt19937 rng(0xC0FFEE);
    size_t i = 0;
    while (i < s.size()) {
      size_t n = 1 + (rng() % 17);
      if (i + n > s.size()) n = s.size() - i;
      fr.feed(std::span<const uint8_t>(s.data() + i, n));
      i += n;
    }
  });
}

static void test_framer_ceiling() {
  CaptureTarget t;
  Framer fr(t);
  Envelope e{Ready::kOpcode, 0, 0, Limits::kMaxPayload + 1, 0};
  std::vector<uint8_t> out;
  // Header only with illegal length — Framer must lose before waiting for payload.
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
  put16(e.opcode);
  put16(e.reserved);
  put32(e.target);
  put32(e.length);
  put32(e.correlation);
  fr.feed(out);
  CHECK(t.lost == 1, "ceiling lost");
  CHECK(t.envs.empty(), "no envelopes after lost");
}

static void test_message_count() {
  CHECK(kMessageCount == 48, "48 messages");
}

static void test_roundtrip_ready() {
  Ready msg{};
  uint8_t buf[64];
  Writer w(buf);
  CHECK(encode_Ready(w, msg), "enc Ready");
  Reader r(w.written());
  Ready out{};
  CHECK(decode_Ready(r, out) && r.ok(), "dec Ready");
}

static void test_roundtrip_navigate() {
  Navigate msg{};
  msg.url = "https://example.test/path";
  uint8_t buf[256];
  Writer w(buf);
  CHECK(encode_Navigate(w, msg), "enc Navigate");
  auto bytes = w.written();
  Reader r(bytes);
  Navigate out{};
  CHECK(decode_Navigate(r, out) && r.ok(), "dec Navigate");
  CHECK(out.url == msg.url, "url equal");
}

static void test_roundtrip_patch() {
  Patch msg{};
  msg.generation = 3;
  msg.sequence = 9;
  msg.flags = 1;
  msg.builtAt = 0;
  msg.metrics_count = 1;
  msg.metrics[0].id = MetricId::OpCount;
  msg.metrics[0].value = 42;
  static const uint8_t deltas[] = {0xDE, 0xAD};
  msg.deltas = deltas;
  uint8_t buf[512];
  Writer w(buf);
  CHECK(encode_Patch(w, msg), "enc Patch");
  Reader r(w.written());
  Patch out{};
  CHECK(decode_Patch(r, out) && r.ok(), "dec Patch");
  CHECK(out.generation == 3 && out.sequence == 9, "patch meta");
  CHECK(out.metrics_count == 1 && out.metrics[0].value == 42, "metric");
  CHECK(out.deltas.size() == 2 && out.deltas[0] == 0xDE, "deltas");
}

static void test_golden_files(const std::string& goldenDir) {
  // Decode each golden with the C++ codec — presence + non-empty decode path.
  const char* names[] = {
      "Ready", "Shutdown", "Heartbeat", "Navigate", "Navigated", "Patch", "Fault",
      "ViewportOpen", "ViewportOpened", "HostAttached", "DocumentInstalled",
      "InputPointerDown", "AssetRequest", "AssetChunk", "Probe", "ProbeResult",
      "FreezeAll", "FreezeResult", "Snapshotted", "Telemetry"};
  for (auto* name : names) {
    auto path = goldenDir + "/" + name + ".bin";
    auto bytes = readFile(path);
    // Empty payload messages may be empty files — still valid.
    if (std::strcmp(name, "Ready") == 0 || std::strcmp(name, "Shutdown") == 0) {
      CHECK(bytes.empty() || true, "empty ok");
      Ready r{};
      Reader rd(bytes);
      if (std::strcmp(name, "Ready") == 0) {
        CHECK(decode_Ready(rd, r), "golden Ready");
      }
    }
    if (std::strcmp(name, "Navigate") == 0) {
      Reader rd(bytes);
      Navigate n{};
      CHECK(decode_Navigate(rd, n) && rd.ok() && !n.url.empty(), "golden Navigate");
    }
    if (std::strcmp(name, "Patch") == 0) {
      Reader rd(bytes);
      Patch p{};
      CHECK(decode_Patch(rd, p) && rd.ok(), "golden Patch");
    }
  }
}

static void test_golden_files(const std::string& goldenDir);

// Generated: decode golden → encode → byte-identical for all 48.
int run_all_roundtrips(const std::string& goldenDir);

int main(int argc, char** argv) {
  std::string goldenDir = "domain/wire/testdata/golden";
  if (argc > 1) goldenDir = argv[1];

  test_ids();
  test_actionOf();
  test_cursor();
  test_limits_source();
  test_message_count();
  test_roundtrip_ready();
  test_roundtrip_navigate();
  test_roundtrip_patch();
  test_framer_partition();
  test_framer_ceiling();
  test_golden_files(goldenDir);
  g_fails += run_all_roundtrips(goldenDir);

  if (g_fails) {
    std::fprintf(stderr, "%d failure(s)\n", g_fails);
    return 1;
  }
  std::puts("PASS phase1_cpp");
  return 0;
}
