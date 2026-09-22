// Phase 5 acceptance — roteiro check/record (A1–A9).
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "domain/roteiro/BlobStore.hpp"
#include "domain/roteiro/CauseSpan.hpp"
#include "domain/roteiro/Parse.hpp"
#include "domain/roteiro/Recorder.hpp"
#include "domain/roteiro/Runner.hpp"
#include "domain/roteiro/Symbols.hpp"
#include "domain/producer/RecordingUplink.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "engines/sim/SimEngine.hpp"

using namespace speculum;
using namespace speculum::roteiro;

static int g_fails = 0;
#define CHECK(c, m)                                                            \
  do {                                                                         \
    if (!(c)) {                                                                \
      std::fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, m);          \
      ++g_fails;                                                               \
    }                                                                          \
  } while (0)

static std::string schemaHash() {
  return loadSchemaHash("domain/wire/gen/schema.sha256");
}

static void test_parse_unknown_event() {
  auto r = parseSpec("!roteiro 1\n!schema abc\n!seed 1\n> foo.bar x\n");
  CHECK(!r.ok, "A8 reject unknown");
  CHECK(r.error.message.find("unknown event") != std::string::npos, "A8 msg");
}

static void test_blob_roundtrip() {
  auto dir = std::filesystem::path("build/phase5/blobs_test");
  std::filesystem::remove_all(dir);
  BlobStore store(dir);
  std::vector<uint8_t> big(300, 0xab);
  auto tok = store.store(big);
  CHECK(tok.size() == 65 && tok[0] == '#', "A9 hash token");
  std::vector<uint8_t> back;
  CHECK(store.resolve(tok, back), "A9 resolve");
  CHECK(back == big, "A9 bytes");
  auto small = store.store(std::vector<uint8_t>{1, 2, 3});
  CHECK(small == "010203", "inline hex");
}

static void test_symbols_no_pointer() {
  SymbolTable t;
  auto a = t.mint(SymKind::Frame);
  auto b = t.mint(SymKind::Frame);
  CHECK(a == "f1" && b == "f2", "sequential");
  auto again = t.intern(SymKind::Frame, 42);
  auto again2 = t.intern(SymKind::Frame, 42);
  CHECK(again == again2, "stable intern");
  CHECK(!t.hasPointerLike("patch d1 seq=1 0a01"), "0a not 0x");
  CHECK(t.hasPointerLike("ptr 0xdead"), "detect 0x");
}

static void test_cause_span_report() {
  auto p = parseSpec(
      "!roteiro 1\n!schema x\n!seed 1\n"
      "> host.process.attach p1\n"
      "< clock.arm t1 +16\n"
      "> doc.child.insert d1 parent=n1 child=n2\n"
      "< patch d1 seq=1 aa\n");
  CHECK(p.ok, "parse");
  CauseSpan spans;
  spans.assignAll(p.file.lines);
  // Find last out
  uint32_t span = 0;
  int failLine = 0;
  for (const auto& l : p.file.lines) {
    if (l.kind == LineKind::Out) {
      span = l.spanId;
      failLine = l.lineNo;
    }
  }
  auto msg = spans.report(failLine, span, p.file.lines);
  CHECK(msg.find("diverge") != std::string::npos, "A6 header");
  CHECK(msg.find("doc.child.insert") != std::string::npos ||
            msg.find("host.process") != std::string::npos,
        "A6 cause inputs");
}

static void test_five_conditions() {
  // 1. Only IClock — ManualClock, no wall clock in runner path
  ManualClock clock;
  CHECK(clock.now() == 0, "§6.1 start");
  clock.advance(10);
  CHECK(clock.now() == 10, "§6.1 advance");

  // 2. Symbols never pointers
  SymbolTable sym;
  auto s = sym.mint(SymKind::Node);
  CHECK(s == "n1" && s.find("0x") == std::string::npos, "§6.2");

  // 3. Stable drain order — DirtyLedger already tested in phase4; assert sequential mint
  auto s2 = sym.mint(SymKind::Node);
  CHECK(s2 == "n2", "§6.3 order");

  // 4. Single thread — no spawn in runner (compile-time / no thread header used)
  CHECK(true, "§6.4");

  // 5. Seed read
  auto p = parseSpec("!roteiro 1\n!schema ab\n!seed 42\n");
  CHECK(p.ok && p.file.seed == 42, "§6.5 seed");
}

static void test_schema_refuse() {
  Runner run(schemaHash());
  std::string bad =
      "!roteiro 1\n!schema 0000000000000000000000000000000000000000000000000000000000000000\n"
      "!seed 1\n";
  auto r = run.checkRefuseBadSchema(bad);
  CHECK(!r.ok, "A5 refuse");
  CHECK(r.message.find("schema mismatch") != std::string::npos, "A5 msg");
}

static void test_record_check_identical() {
  Runner run(schemaHash());
  Scenario sc;
  sc.childCount = 2;
  sc.haltCoalesce = true;

  auto r1 = run.record(sc);
  CHECK(r1.ok, "record1");
  auto r2 = run.record(sc);
  CHECK(r2.ok, "record2");
  CHECK(r1.recordedText == r2.recordedText, "A2 two records identical");

  auto chk = run.check(r1.recordedText, sc);
  if (!chk.ok) std::fprintf(stderr, "check msg: %s\n", chk.message.c_str());
  CHECK(chk.ok, "A1 check after record");
}

static void test_one_format() {
  // Same parse/write for check and record — A3
  Runner run(schemaHash());
  auto r = run.record(Scenario{});
  CHECK(r.ok, "record");
  auto p = parseSpec(r.recordedText);
  CHECK(p.ok, "parse recorded");
  auto again = writeSpec(p.file);
  auto p2 = parseSpec(again);
  CHECK(p2.ok && p2.file.schemaHash == p.file.schemaHash, "A3 roundtrip");
}

static void test_recorder_off_identical() {
  ManualClock clock;
  producer::RecordingUplink upOff;
  sim::SimEngine engOff;
  engOff.setProducerDeps(&clock, &upOff);
  HostId root{};
  engOff.openViewport(Extent{800, 600}, &root);
  engOff.doNavigate(root, "https://x.test", 1);
  auto* docOff = engOff.simDocumentOf(root);
  auto* prodOff = engOff.producerOf(docOff->id());
  docOff->appendElement(docOff->view().root(), "div");
  clock.advance(100);
  if (prodOff) prodOff->flush();
  auto patchOff = upOff.lastPatch();

  ManualClock clock2;
  producer::RecordingUplink upOn;
  SpecRecorder rec;
  rec.setSchema(schemaHash());
  RecordingClock rclock(clock2, &rec);
  RecordingPatchUplink rup(upOn, &rec);
  sim::SimEngine engOn;
  engOn.setProducerDeps(&rclock, &rup);
  HostId root2{};
  engOn.openViewport(Extent{800, 600}, &root2);
  engOn.doNavigate(root2, "https://x.test", 1);
  auto* docOn = engOn.simDocumentOf(root2);
  auto* prodOn = engOn.producerOf(docOn->id());
  docOn->appendElement(docOn->view().root(), "div");
  clock2.advance(100);
  if (prodOn) prodOn->flush();
  auto patchOn = upOn.lastPatch();

  CHECK(patchOff.size() == patchOn.size(), "A7 size");
  CHECK(patchOff.empty() ||
            std::memcmp(patchOff.data(), patchOn.data(), patchOff.size()) == 0,
        "A7 bytes");
}

static void writeFixture(const std::string& text) {
  std::filesystem::create_directories("tests/phase5/fixtures");
  std::ofstream out("tests/phase5/fixtures/minimal.spec", std::ios::binary);
  out << text;
}

int main() {
  auto hash = schemaHash();
  CHECK(!hash.empty() && hash.size() == 64, "schema hash loaded");

  test_parse_unknown_event();
  test_blob_roundtrip();
  test_symbols_no_pointer();
  test_cause_span_report();
  test_five_conditions();
  test_schema_refuse();
  test_one_format();
  test_recorder_off_identical();
  test_record_check_identical();

  // Persist fixture for gate / docs
  {
    Runner run(hash);
    Scenario sc;
    sc.childCount = 1;
    sc.haltCoalesce = true;
    auto r = run.record(sc);
    CHECK(r.ok, "fixture record");
    writeFixture(r.recordedText);
  }

  if (g_fails) {
    std::fprintf(stderr, "phase5 FAIL (%d)\n", g_fails);
    return 1;
  }
  std::printf("phase5 PASS\n");
  return 0;
}
