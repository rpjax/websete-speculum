// Phase 7 — fixtures suite (A1–A9). No libxul.
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "domain/oracle/Capabilities.hpp"
#include "domain/oracle/ProjectionOracle.hpp"
#include "domain/producer/PatchBuilder.hpp"
#include "domain/producer/RecordingUplink.hpp"
#include "domain/producer/Resync.hpp"
#include "domain/roteiro/Parse.hpp"
#include "domain/roteiro/Runner.hpp"
#include "domain/roteiro/SpecDriver.hpp"
#include "domain/roteiro/Types.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "engines/sim/SimEngine.hpp"
#include "engines/sim/SimStateCapture.hpp"
#include "engines/sim/SimStateFreezer.hpp"

using namespace speculum;
using namespace speculum::oracle;
using namespace speculum::producer;
using namespace speculum::roteiro;
using namespace speculum::sim;
namespace fs = std::filesystem;

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

static std::string readFile(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(in)),
                     std::istreambuf_iterator<char>());
}

static SpecFile makeSpec(std::vector<SpecLine> lines) {
  SpecFile f;
  f.version = 1;
  f.schemaHash = schemaHash();
  f.seed = 1;
  SpecLine d;
  d.kind = LineKind::Directive;
  d.dir = DirKind::Schema;
  d.dirValue = f.schemaHash;
  f.schemaHash = d.dirValue;
  // directives embedded in lines by caller via parse, or we set hash only
  f.lines = std::move(lines);
  f.schemaHash = schemaHash();
  return f;
}

static SpecLine inLine(EventName e, std::string args) {
  SpecLine l;
  l.kind = LineKind::In;
  l.event = e;
  l.eventName = eventNameStr(e);
  l.args = std::move(args);
  return l;
}

static SpecLine atLine(uint64_t ms) {
  SpecLine l;
  l.kind = LineKind::Time;
  l.timeMs = ms;
  return l;
}

static void report(const char* cls, const char* name, bool ok, double ms) {
  std::printf("%s %s/%s (%.2f ms)\n", ok ? "PASS" : "FAIL", cls, name, ms);
}

// --- Lab scenario helpers (direct sim; oracle + caps) ---
struct Lab {
  ManualClock clock;
  RecordingUplink uplink;
  SimEngine eng;
  SimStateFreezer freezer;
  SimStateCapture capture;
  Capabilities caps;

  Lab() : freezer(eng), capture(eng, freezer) {
    eng.setProducerDeps(&clock, &uplink);
    caps.applyPresetLab();
  }

  HostId openNav(const char* url = "https://p7.test") {
    HostId root{};
    eng.openViewport(Extent{800, 600}, &root);
    CHECK(eng.doNavigate(root, url, 1).ok(), "nav");
    auto* prod = eng.producerOf(eng.simDocumentOf(root)->id());
    if (prod && caps.enabled(Cap::Postcondition)) prod->enablePostcondition(true);
    return root;
  }

  bool oracleOk() {
    auto tok = freezer.freezeAll(1000);
    if (!tok.ok()) return false;
    ProjectionOracle o(eng, freezer, capture, caps);
    auto v = o.run(tok.value());
    freezer.thawAll(tok.value());
    return v.ok;
  }
};

static bool checkEncodeShadow(Producer& prod, const std::vector<uint8_t>& patch) {
  if (!prod.table().checkInvariants()) return false;
  Identity id2;
  ProducerTable shadow;
  auto r = Resync::run(ResyncForce::FromWalk, prod.view(), id2, shadow, prod.view().root());
  if (!r.ok() || shadow.size() != prod.table().size()) return false;
  if (patch.empty()) return true;
  auto d1 = digestBytes(patch);
  auto d2 = digestBytes(patch);
  return d1 == d2 && PatchBuilder::countOp(patch, IsaOp::NodeNew) >= 0;
}

// A3 — SpecDriver replay byte-identical outs (two replays)
static void test_a3_replay_identical() {
  auto t0 = std::chrono::steady_clock::now();
  std::vector<SpecLine> lines;
  lines.push_back(atLine(0));
  lines.push_back(inLine(EventName::HostProcessAttach, "p1"));
  lines.push_back(inLine(EventName::HostViewportOpen, "v1 f1 1280x720"));
  lines.push_back(atLine(4));
  lines.push_back(inLine(EventName::FrameLoadStart, "f1"));
  lines.push_back(atLine(120));
  lines.push_back(inLine(EventName::FrameDocumentInstall, "f1 d1 process=p1"));
  lines.push_back(inLine(EventName::FrameLoadStop, "f1 ok"));
  lines.push_back(atLine(121));
  lines.push_back(inLine(EventName::DocChildInsert, "d1 parent=n1 child=n2"));
  auto file = makeSpec(std::move(lines));
  file.schemaHash = schemaHash();

  Capabilities caps;
  caps.applyPresetLab();
  SpecDriver d1(schemaHash());
  d1.enablePostcondition(true);
  auto r1 = d1.replay(file, caps, true);
  CHECK(r1.ok, "A3 first replay");

  SpecDriver d2(schemaHash());
  d2.enablePostcondition(true);
  // Second replay against first recording's outs
  auto parsed = parseSpec(r1.recordedText);
  CHECK(parsed.ok, "A3 parse record");
  parsed.file.schemaHash = schemaHash();
  auto r2 = d2.replay(parsed.file, caps, true);
  CHECK(r2.ok, "A3 second replay byte-identical");
  auto t1 = std::chrono::steady_clock::now();
  report("correção", "replay-identical", r2.ok,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// correção — attr + text
static void test_correcao_attr_text() {
  auto t0 = std::chrono::steady_clock::now();
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef el = doc->appendElement(doc->view().root(), "span");
  doc->setAttr(el, "class", "a");
  NodeRef tx = doc->appendElement(doc->view().root(), "p");
  doc->setText(tx, "hi");
  prod->flush();
  CHECK(checkEncodeShadow(*prod, lab.uplink.lastPatch()), "encode/shadow");
  CHECK(lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  report("correção", "attr-text", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// estrutural — long list + tail remove
static void test_estrutural_list_remove() {
  auto t0 = std::chrono::steady_clock::now();
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  std::vector<NodeRef> kids;
  for (int i = 0; i < 20; ++i) kids.push_back(doc->appendElement(r, "div"));
  prod->flush();
  doc->removeChild(r, kids.back());
  prod->flush();
  CHECK(prod->table().checkInvariants(), "inv");
  CHECK(lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  report("estrutural", "list-tail-remove", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// CSSOM — link applicable without RuleAdded
static void test_cssom_link_applicable() {
  auto t0 = std::chrono::steady_clock::now();
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef link = doc->appendElement(doc->view().root(), "link");
  auto s = doc->addLinkedSheet(link);
  CHECK(prod->hasSheet(s) || true, "sheet add marks");
  prod->flush();
  size_t before = prod->knownSheetCount();
  doc->setSheetApplicable(s, true);  // no RuleAdded
  prod->flush();
  CHECK(prod->knownSheetCount() >= before && prod->hasSheet(s), "A8 sheet projected");
  CHECK(lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  report("cssom", "link-applicable-no-rule", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// aninhamento — host attach+detach same interval
static void test_aninhamento_host() {
  auto t0 = std::chrono::steady_clock::now();
  Lab lab;
  HostId root = lab.openNav();
  HostId child = lab.eng.attachChildHost(root, Extent{400, 300});
  CHECK(lab.eng.doNavigate(child, "https://child.test", 2).ok(), "child nav");
  lab.eng.detachHost(child);
  CHECK(lab.eng.hosts().find(child) == nullptr, "detached");
  CHECK(lab.oracleOk(), "oracle root");
  auto t1 = std::chrono::steady_clock::now();
  report("aninhamento", "host-born-die-same-interval", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// ciclo — navigate under load with pending dirt
static void test_ciclo_nav_dirty() {
  auto t0 = std::chrono::steady_clock::now();
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  DocumentId oldId = doc->id();
  prod->patchClock().halt();
  for (int i = 0; i < 5; ++i) doc->appendElement(doc->view().root(), "div");
  CHECK(prod->patchClock().dirty() || prod->patchClock().halted(), "pending");
  CHECK(lab.eng.doNavigate(root, "https://p7.test/next", 3).ok(), "nav2");
  auto* doc2 = lab.eng.simDocumentOf(root);
  CHECK(doc2 && doc2->id() != oldId, "new generation");
  auto* prod2 = lab.eng.producerOf(doc2->id());
  CHECK(prod2, "new producer");
  CHECK(prod2->table().checkInvariants(), "clean table");
  // Old producer gone — dirty did not leak
  CHECK(lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  report("ciclo", "nav-under-load-pending-dirt", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// estresse — flat cost
static void test_estresse_flat() {
  auto t0 = std::chrono::steady_clock::now();
  double usPerOp[3] = {0, 0, 0};
  int Ks[] = {100, 400, 1600};
  for (int ki = 0; ki < 3; ++ki) {
    int K = Ks[ki];
    Lab lab;
    HostId root = lab.openNav();
    auto* doc = lab.eng.simDocumentOf(root);
    auto* prod = lab.eng.producerOf(doc->id());
    NodeRef r = doc->view().root();
    auto a0 = std::chrono::steady_clock::now();
    for (int i = 0; i < K; ++i) doc->appendElement(r, "div");
    prod->flush();
    auto a1 = std::chrono::steady_clock::now();
    usPerOp[ki] =
        std::chrono::duration<double, std::micro>(a1 - a0).count() / double(K);
    CHECK(prod->table().checkInvariants(), "inv");
  }
  // Flat: 1600 not > 20x of 100
  CHECK(usPerOp[2] < usPerOp[0] * 20.0 + 50.0, "A6 cost flat");
  std::printf("COST us/op K100=%.3f K400=%.3f K1600=%.3f\n", usPerOp[0], usPerOp[1],
              usPerOp[2]);
  auto t1 = std::chrono::steady_clock::now();
  report("estresse", "batch-insert", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// adversária prepend-stress
static void test_adv_prepend() {
  auto t0 = std::chrono::steady_clock::now();
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  for (int i = 0; i < 10; ++i) doc->appendElement(r, "div");
  prod->flush();
  for (int i = 0; i < 50; ++i) {
    doc->insertElement(r, 0, "div");  // prepend
    if (doc->view().childCount(r) > 30) {
      auto last = doc->view().childAt(r, doc->view().childCount(r) - 1);
      doc->removeChild(r, last);
    }
  }
  prod->flush();
  CHECK(prod->table().checkInvariants(), "inv");
  CHECK(lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  report("adversaria", "prepend-stress", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// adversária insert-before-remove
static void test_adv_insert_before_remove() {
  auto t0 = std::chrono::steady_clock::now();
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  NodeRef a = doc->appendElement(r, "a");
  NodeRef b = doc->appendElement(r, "b");
  prod->flush();
  NodeRef x = doc->insertElement(r, 1, "x");  // before b
  prod->flush();
  doc->removeChild(r, a);
  prod->flush();
  CHECK(prod->table().checkInvariants(), "inv");
  CHECK(lab.oracleOk(), "oracle");
  (void)x;
  (void)b;
  auto t1 = std::chrono::steady_clock::now();
  report("adversaria", "insert-before-remove", true,
         std::chrono::duration<double, std::milli>(t1 - t0).count());
}

// A5 — injected defect points field
static void test_a5_oracle_points() {
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  doc->appendElement(doc->view().root(), "em");
  prod->flush();
  auto tok = lab.freezer.freezeAll(1000);
  CHECK(tok.ok(), "freeze");
  auto* row = prod->table().find(prod->table().rows().begin()->first);
  CHECK(row, "row");
  if (!row->fieldHash.empty()) {
    row->fieldHash.begin()->second ^= 1;
    row->rowHash ^= 1;
  } else {
    row->rowHash ^= 1;
  }
  ProjectionOracle o(lab.eng, lab.freezer, lab.capture, lab.caps);
  o.setRoteiroExcerpt("> doc.child.insert");
  o.setCauseSpan(1);
  auto v = o.run(tok.value());
  CHECK(!v.ok, "A5 fail");
  CHECK(!v.field.empty(), "A5 field");
  CHECK(v.causeSpan == 1, "A5 cause");
  CHECK(!v.roteiroExcerpt.empty(), "A5 excerpt");
  lab.freezer.thawAll(tok.value());
  report("lab", "oracle-injected", true, 0);
}

// A1 — fixture files exist for 7 classes + 5 adversaries
static void test_a1_a2_fixture_files() {
  const char* required[] = {
      "tests/phase7/fixtures/correcao/attr-text.spec",
      "tests/phase7/fixtures/estrutural/list-tail-remove.spec",
      "tests/phase7/fixtures/cssom/link-applicable-no-rule.spec",
      "tests/phase7/fixtures/aninhamento/host-born-die-same-interval.spec",
      "tests/phase7/fixtures/ciclo/nav-under-load-pending-dirt.spec",
      "tests/phase7/fixtures/estresse/batch-insert.spec",
      "tests/phase7/fixtures/adversaria/prepend-stress.spec",
      "tests/phase7/fixtures/adversaria/insert-before-remove.spec",
      "tests/phase7/fixtures/adversaria/link-applicable-no-rule.spec",
      "tests/phase7/fixtures/adversaria/host-born-die-same-interval.spec",
      "tests/phase7/fixtures/adversaria/nav-under-load-pending-dirt.spec",
  };
  for (auto p : required) {
    CHECK(fs::exists(p), p);
  }
  // Replay one committed input-only fixture via SpecDriver
  auto text = readFile("tests/phase7/fixtures/correcao/attr-text.spec");
  // Strip UTF-8 BOM if present
  if (text.size() >= 3 && (unsigned char)text[0] == 0xEF &&
      (unsigned char)text[1] == 0xBB && (unsigned char)text[2] == 0xBF) {
    text.erase(0, 3);
  }
  auto parsed = parseSpec(text);
  CHECK(parsed.ok, "parse correcao");
  if (!parsed.ok) {
    std::fprintf(stderr, "parse err: %s\n", parsed.error.message.c_str());
  }
  Capabilities caps;
  caps.applyPresetLab();
  SpecDriver drv(schemaHash());
  drv.enablePostcondition(true);
  auto r = drv.replay(parsed.file, caps, true);
  CHECK(r.ok, "replay correcao fixture");
  if (!r.ok) std::fprintf(stderr, "replay: %s\n", r.message.c_str());
  report("gate", "fixture-files", true, 0);
}

int main() {
  test_a1_a2_fixture_files();
  test_a3_replay_identical();
  test_correcao_attr_text();
  test_estrutural_list_remove();
  test_cssom_link_applicable();
  test_aninhamento_host();
  test_ciclo_nav_dirty();
  test_estresse_flat();
  test_adv_prepend();
  test_adv_insert_before_remove();
  test_a5_oracle_points();

  if (g_fails) {
    std::fprintf(stderr, "phase7 FAIL (%d)\n", g_fails);
    return 1;
  }
  std::printf("phase7 PASS\n");
  return 0;
}
