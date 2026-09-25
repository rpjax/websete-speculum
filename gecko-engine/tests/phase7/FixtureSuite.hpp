#pragma once

// Shared Phase 7 fixture suite body — Traits-parameterized.
// Host entry: phase7_tests.cpp (Sim). In-tree: SpeculumPhase7.* (Gecko).
// No motor ifs. No copy of body.

#include <algorithm>
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
#include "domain/roteiro/Types.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "tests/phase7/EngineTraits.hpp"

namespace speculum::phase7 {

namespace fs = std::filesystem;
using namespace speculum::oracle;
using namespace speculum::producer;
using namespace speculum::roteiro;

struct SuiteReport {
  int fails{0};
  int fixtureReplays{0};  // .spec SpecDriver replays (Phase 9 compared count)
  std::vector<std::string> labScenarios;  // Lab scenario names (Suite/Case style)
  void check(bool c, const char* m, const char* file, int line) {
    if (!c) {
      std::fprintf(stderr, "FAIL %s:%d %s\n", file, line, m);
      ++fails;
    }
  }
};

// Verdict only. Progress (scenario names / timings) goes through reportProgress.
#define P7_CHECK(rep, c, m) (rep).check(!!(c), (m), __FILE__, __LINE__)

// Lab scenarios counted by name (same shape as scripts/ci/speculum-gtest-expect.txt).
// Not the 13 .spec fixture replays — those are fixtureReplays.
inline constexpr const char* kExpectedLabScenarios[] = {
    "correção/replay-identical",
    "correção/attr-text",
    "estrutural/list-tail-remove",
    "cssom/link-applicable-no-rule",
    "aninhamento/host-born-die-same-interval",
    "aninhamento/nested-shadow",
    "ciclo/nav-under-load-pending-dirt",
    "estresse/batch-insert",
    "adversaria/prepend-stress",
    "adversaria/insert-before-remove",
    "adversaria/onchildlist-sibling-scan",
    "adversaria/live-prevsibling-scan",
    "lab/oracle-injected",
};

// Progress line only — does not assert. Verdict is P7_CHECK.
inline void reportProgress(SuiteReport& rep, const char* cls, const char* name,
                           double ms) {
  std::printf("PROGRESS %s/%s (%.2f ms)\n", cls, name, ms);
  rep.labScenarios.emplace_back(std::string(cls) + "/" + name);
}

inline std::string defaultSchemaHash() {
  return "019b629d0cc8374708a62af3177a1f22d06dd0b817a22a32db6dd34a61137142";
}

inline std::string readFile(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(in)),
                     std::istreambuf_iterator<char>());
}

inline void stripBom(std::string& text) {
  if (text.size() >= 3 && (unsigned char)text[0] == 0xEF &&
      (unsigned char)text[1] == 0xBB && (unsigned char)text[2] == 0xBF) {
    text.erase(0, 3);
  }
}

inline SpecFile makeSpec(std::vector<SpecLine> lines, const std::string& schema) {
  SpecFile f;
  f.version = 1;
  f.schemaHash = schema;
  f.seed = 1;
  f.lines = std::move(lines);
  return f;
}

inline SpecLine inLine(EventName e, std::string args) {
  SpecLine l;
  l.kind = LineKind::In;
  l.event = e;
  l.eventName = eventNameStr(e);
  l.args = std::move(args);
  return l;
}

inline SpecLine atLine(uint64_t ms) {
  SpecLine l;
  l.kind = LineKind::Time;
  l.timeMs = ms;
  return l;
}

// Two independent FromWalk fills must agree with the live producer table.
// (Digest of the same patch twice is not a check.)
inline bool checkEncodeShadow(Producer& prod, const std::vector<uint8_t>& /*patch*/) {
  if (!prod.table().checkInvariants()) return false;
  Identity idA;
  Identity idB;
  ProducerTable shadowA;
  ProducerTable shadowB;
  auto rA =
      Resync::run(ResyncForce::FromWalk, prod.view(), idA, shadowA, prod.view().root());
  auto rB =
      Resync::run(ResyncForce::FromWalk, prod.view(), idB, shadowB, prod.view().root());
  if (!rA.ok() || !rB.ok()) return false;
  if (shadowA.size() != prod.table().size() || shadowB.size() != prod.table().size())
    return false;
  if (shadowA.tableHash() != shadowB.tableHash()) return false;
  return shadowA.tableHash() == prod.table().tableHash();
}

template <typename Traits>
struct FixtureLab {
  using Engine = typename Traits::Engine;
  using Freezer = typename Traits::Freezer;
  using Capture = typename Traits::Capture;

  ManualClock clock;
  RecordingUplink uplink;
  Engine& eng;
  Freezer& freezer;
  Capture& capture;
  Capabilities caps;
  SuiteReport& rep;

  FixtureLab(Engine& e, Freezer& fz, Capture& cap, SuiteReport& r)
      : eng(e), freezer(fz), capture(cap), rep(r) {
    eng.setProducerDeps(&clock, &uplink);
    caps.applyPresetLab();
  }

  HostId openNav(const char* url = "https://p7.test") {
    HostId root{};
    eng.openViewport(Extent{800, 600}, &root);
    P7_CHECK(rep, eng.doNavigate(root, url, 1).ok(), "nav");
    auto* doc = Traits::documentOf(eng, root);
    if (doc) {
      auto* prod = eng.producerOf(doc->id());
      if (prod && caps.enabled(Cap::Postcondition)) prod->enablePostcondition(true);
    }
    return root;
  }

  bool oracleOk() {
    auto tok = freezer.freezeAll(1000);
    if (!tok.ok()) return false;
    ProjectionOracle o(Traits::hosts(eng), freezer, capture, caps);
    auto v = o.run(tok.value());
    freezer.thawAll(tok.value());
    return v.ok;
  }
};

template <typename Traits>
inline void test_a3_replay_identical(SuiteReport& rep, const std::string& schema) {
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
  auto file = makeSpec(std::move(lines), schema);

  Capabilities caps;
  caps.applyPresetLab();
  SpecDriverT<Traits> d1(schema);
  d1.enablePostcondition(true);
  auto r1 = d1.replay(file, caps, true);
  P7_CHECK(rep, r1.ok, "A3 first replay");

  SpecDriverT<Traits> d2(schema);
  d2.enablePostcondition(true);
  auto parsed = parseSpec(r1.recordedText);
  P7_CHECK(rep, parsed.ok, "A3 parse record");
  parsed.file.schemaHash = schema;
  auto r2 = d2.replay(parsed.file, caps, true);
  P7_CHECK(rep, r2.ok, "A3 second replay byte-identical");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(rep, "correção", "replay-identical", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_correcao_attr_text(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  P7_CHECK(lab.rep, doc != nullptr, "doc");
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef el = doc->appendElement(doc->view().root(), "span");
  doc->setAttr(el, "class", "a");
  NodeRef tx = doc->appendElement(doc->view().root(), "p");
  doc->setText(tx, "hi");
  prod->flush();
  P7_CHECK(lab.rep, checkEncodeShadow(*prod, lab.uplink.lastPatch()), "encode/shadow");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "correção", "attr-text", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_estrutural_list_remove(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  std::vector<NodeRef> kids;
  for (int i = 0; i < 20; ++i) kids.push_back(doc->appendElement(r, "div"));
  prod->flush();
  doc->removeChild(r, kids.back());
  prod->flush();
  P7_CHECK(lab.rep, prod->table().checkInvariants(), "inv");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "estrutural", "list-tail-remove", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_cssom_link_applicable(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef link = doc->appendElement(doc->view().root(), "link");
  auto s = doc->addLinkedSheet(link);
  prod->flush();
  size_t before = prod->knownSheetCount();
  doc->setSheetApplicable(s, true);
  prod->flush();
  P7_CHECK(lab.rep, prod->knownSheetCount() >= before && prod->hasSheet(s),
           "A8 sheet projected");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "cssom", "link-applicable-no-rule", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_aninhamento_host(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  HostId child = lab.eng.attachChildHost(root, Extent{400, 300});
  P7_CHECK(lab.rep, lab.eng.doNavigate(child, "https://child.test", 2).ok(), "child nav");
  lab.eng.detachHost(child);
  P7_CHECK(lab.rep, Traits::hosts(lab.eng).find(child) == nullptr, "detached");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle root");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "aninhamento", "host-born-die-same-interval", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_aninhamento_nested_shadow(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef host1 = doc->appendElement(doc->view().root(), "host1");
  NodeRef sr1 = doc->attachShadow(host1);
  P7_CHECK(lab.rep, sr1.valid(), "shadow1");
  NodeRef host2 = doc->appendElement(sr1, "host2");
  NodeRef sr2 = doc->attachShadow(host2);
  P7_CHECK(lab.rep, sr2.valid(), "shadow2 nested");
  P7_CHECK(lab.rep, doc->view().shadowRoot(host1) == sr1, "shadowRoot1");
  prod->flush();
  P7_CHECK(lab.rep, prod->table().checkInvariants(), "inv");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "aninhamento", "nested-shadow", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_ciclo_nav_dirty(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  DocumentId oldId = doc->id();
  prod->patchClock().halt();
  for (int i = 0; i < 5; ++i) doc->appendElement(doc->view().root(), "div");
  P7_CHECK(lab.rep, prod->patchClock().dirty() || prod->patchClock().halted(), "pending");
  P7_CHECK(lab.rep, lab.eng.doNavigate(root, "https://p7.test/next", 3).ok(), "nav2");
  auto* doc2 = Traits::documentOf(lab.eng, root);
  P7_CHECK(lab.rep, doc2 && doc2->id() != oldId, "new generation");
  auto* prod2 = lab.eng.producerOf(doc2->id());
  P7_CHECK(lab.rep, prod2 != nullptr, "new producer");
  P7_CHECK(lab.rep, prod2->table().checkInvariants(), "clean table");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "ciclo", "nav-under-load-pending-dirt", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_estresse_flat(SuiteReport& rep, typename Traits::Engine& engTemplate) {
  (void)engTemplate;
  auto t0 = std::chrono::steady_clock::now();
  double usPerOp[3] = {0, 0, 0};
  int Ks[] = {100, 400, 1600};
  for (int ki = 0; ki < 3; ++ki) {
    int K = Ks[ki];
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    HostId root = lab.openNav();
    auto* doc = Traits::documentOf(lab.eng, root);
    auto* prod = lab.eng.producerOf(doc->id());
    NodeRef r = doc->view().root();
    prod->resetSiblingScanMark();
    auto a0 = std::chrono::steady_clock::now();
    for (int i = 0; i < K; ++i) doc->appendElement(r, "div");
    prod->flush();
    auto a1 = std::chrono::steady_clock::now();
    usPerOp[ki] =
        std::chrono::duration<double, std::micro>(a1 - a0).count() / double(K);
    P7_CHECK(rep, prod->table().checkInvariants(), "inv");
    // Aceite A6: uma corrida de irmãos ⇒ um INSERT e uma resolução de before.
    // Tempo (us/op) é só sinal impresso — não portão.
    P7_CHECK(rep,
             PatchBuilder::countOp(lab.uplink.lastPatch(), IsaOp::Insert) == 1,
             "A6 one INSERT per sibling run");
    // Sibling-proportional walks (any path): must stay charged 0 with O(1) index/hint.
    P7_CHECK(rep, prod->siblingScanMark().steps(SiblingScanPath::OnChildList) == 0,
             "A6 OnChildList sibling-walk steps == 0");
    P7_CHECK(rep, prod->siblingScanFlush().steps(SiblingScanPath::LivePrevSibling) == 0,
             "A6 LivePrevSibling sibling-walk steps == 0");
    P7_CHECK(rep, prod->siblingScanMark().totalSteps() == 0 &&
                       prod->siblingScanFlush().totalSteps() == 0,
             "A6 no sibling-proportional walks in batch flush");
  }
  std::printf("COST us/op K100=%.3f K400=%.3f K1600=%.3f (signal only)\n", usPerOp[0],
              usPerOp[1], usPerOp[2]);
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(rep, "estresse", "batch-insert",
                 std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_adv_prepend(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  for (int i = 0; i < 10; ++i) doc->appendElement(r, "div");
  prod->flush();
  for (int i = 0; i < 50; ++i) {
    doc->insertElement(r, 0, "div");
    if (doc->view().childCount(r) > 30) {
      auto last = doc->view().childAt(r, doc->view().childCount(r) - 1);
      doc->removeChild(r, last);
    }
  }
  prod->flush();
  P7_CHECK(lab.rep, prod->table().checkInvariants(), "inv");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "adversaria", "prepend-stress", std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_adv_insert_before_remove(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  NodeRef a = doc->appendElement(r, "a");
  NodeRef b = doc->appendElement(r, "b");
  prod->flush();
  NodeRef x = doc->insertElement(r, 1, "x");
  prod->flush();
  doc->removeChild(r, a);
  prod->flush();
  P7_CHECK(lab.rep, prod->table().checkInvariants(), "inv");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  (void)x;
  (void)b;
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "adversaria", "insert-before-remove", std::chrono::duration<double, std::milli>(t1 - t0).count());
}


template <typename Traits>
inline void test_adv_onchildlist_sibling_scan(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  const int K = 80;
  prod->resetSiblingScanMark();
  for (int i = 0; i < K; ++i) doc->appendElement(r, "div");
  P7_CHECK(lab.rep, prod->siblingScanMark().steps(SiblingScanPath::OnChildList) == 0,
           "OnChildList walk == 0");
  P7_CHECK(lab.rep, prod->siblingScanMark().totalSteps() == 0, "mark total sibling walks == 0");
  prod->flush();
  P7_CHECK(lab.rep, prod->siblingScanFlush().totalSteps() == 0, "flush sibling walks == 0");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "adversaria", "onchildlist-sibling-scan",
                 std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_adv_live_prevsibling_scan(FixtureLab<Traits>& lab) {
  auto t0 = std::chrono::steady_clock::now();
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  const int K = 60;
  std::vector<NodeRef> nodes;
  for (int i = 0; i < K; ++i) nodes.push_back(doc->appendElement(r, "span"));
  prod->flush();
  prod->resetSiblingScanMark();
  for (auto n : nodes) doc->setAttr(n, "class", "x");
  prod->flush();
  P7_CHECK(lab.rep, prod->siblingScanFlush().steps(SiblingScanPath::LivePrevSibling) == 0,
           "LivePrevSibling walk == 0");
  P7_CHECK(lab.rep, prod->siblingScanFlush().totalSteps() == 0, "flush total sibling walks == 0");
  P7_CHECK(lab.rep, lab.oracleOk(), "oracle");
  auto t1 = std::chrono::steady_clock::now();
  reportProgress(lab.rep, "adversaria", "live-prevsibling-scan",
                 std::chrono::duration<double, std::milli>(t1 - t0).count());
}

template <typename Traits>
inline void test_a5_oracle_points(FixtureLab<Traits>& lab) {
  HostId root = lab.openNav();
  auto* doc = Traits::documentOf(lab.eng, root);
  auto* prod = lab.eng.producerOf(doc->id());
  doc->appendElement(doc->view().root(), "em");
  prod->flush();
  auto tok = lab.freezer.freezeAll(1000);
  P7_CHECK(lab.rep, tok.ok(), "freeze");
  auto* row = prod->table().find(prod->table().rows().begin()->first);
  P7_CHECK(lab.rep, row != nullptr, "row");
  if (row) {
    if (!row->fieldHash.empty()) {
      row->fieldHash.begin()->second ^= 1;
      row->rowHash ^= 1;
    } else {
      row->rowHash ^= 1;
    }
  }
  ProjectionOracle o(Traits::hosts(lab.eng), lab.freezer, lab.capture, lab.caps);
  o.setRoteiroExcerpt("> doc.child.insert");
  o.setCauseSpan(1);
  auto v = o.run(tok.value());
  P7_CHECK(lab.rep, !v.ok, "A5 fail");
  P7_CHECK(lab.rep, !v.field.empty(), "A5 field");
  P7_CHECK(lab.rep, v.causeSpan == 1, "A5 cause");
  P7_CHECK(lab.rep, !v.roteiroExcerpt.empty(), "A5 excerpt");
  lab.freezer.thawAll(tok.value());
  reportProgress(lab.rep, "lab", "oracle-injected", 0);
}

template <typename Traits>
inline void test_fixture_files(SuiteReport& rep, const fs::path& fixtureRoot,
                               const std::string& schema) {
  const char* required[] = {
      "correcao/attr-text.spec",
      "estrutural/list-tail-remove.spec",
      "cssom/link-applicable-no-rule.spec",
      "aninhamento/host-born-die-same-interval.spec",
      "aninhamento/nested-shadow.spec",
      "ciclo/nav-under-load-pending-dirt.spec",
      "estresse/batch-insert.spec",
      "adversaria/prepend-stress.spec",
      "adversaria/insert-before-remove.spec",
      "adversaria/link-applicable-no-rule.spec",
      "adversaria/host-born-die-same-interval.spec",
      "adversaria/nav-under-load-pending-dirt.spec",
      "adversaria/nested-shadow.spec",
      "adversaria/onchildlist-sibling-scan.spec",
      "adversaria/live-prevsibling-scan.spec",
  };
  for (auto rel : required) {
    auto p = fixtureRoot / rel;
    P7_CHECK(rep, fs::exists(p), rel);
  }

  Capabilities caps;
  caps.applyPresetLab();
  for (auto rel : required) {
    auto p = fixtureRoot / rel;
    if (!fs::exists(p)) continue;
    auto text = readFile(p);
    stripBom(text);
    auto parsed = parseSpec(text);
    P7_CHECK(rep, parsed.ok, rel);
    if (!parsed.ok) {
      std::fprintf(stderr, "parse %s: %s\n", rel, parsed.error.message.c_str());
      continue;  // already failed CHECK; keep going to surface more errors
    }
    parsed.file.schemaHash = schema;
    SpecDriverT<Traits> drv(schema);
    drv.enablePostcondition(true);
    auto r = drv.replay(parsed.file, caps, true);
    ++rep.fixtureReplays;
    P7_CHECK(rep, r.ok, rel);
    if (!r.ok) std::fprintf(stderr, "replay %s: %s\n", rel, r.message.c_str());
  }
}

// Full suite. Returns fail count.
template <typename Traits>
inline int runFixtureSuite(const fs::path& fixtureRoot,
                           const std::string& schema = defaultSchemaHash()) {
  SuiteReport rep;

  test_fixture_files<Traits>(rep, fixtureRoot, schema);
  test_a3_replay_identical<Traits>(rep, schema);

  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_correcao_attr_text(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_estrutural_list_remove(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_cssom_link_applicable(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_aninhamento_host(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_aninhamento_nested_shadow(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_ciclo_nav_dirty(lab);
  }
  {
    typename Traits::Engine eng;
    test_estresse_flat<Traits>(rep, eng);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_adv_prepend(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_adv_insert_before_remove(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_adv_onchildlist_sibling_scan(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_adv_live_prevsibling_scan(lab);
  }
  {
    typename Traits::Engine eng;
    typename Traits::Freezer freezer(eng);
    typename Traits::Capture capture(eng, freezer);
    FixtureLab<Traits> lab(eng, freezer, capture, rep);
    test_a5_oracle_points(lab);
  }

  constexpr int expectedFixtureReplays = 15;
  constexpr int expectedLab =
      static_cast<int>(sizeof(kExpectedLabScenarios) /
                       sizeof(kExpectedLabScenarios[0]));

  if (rep.fixtureReplays == 0 && rep.labScenarios.empty()) {
    std::fprintf(stderr, "FAIL phase7: suite did no work\n");
    ++rep.fails;
  }
  if (rep.fixtureReplays != expectedFixtureReplays) {
    std::fprintf(stderr,
                 "FAIL phase7: fixtureReplays=%d expected=%d\n",
                 rep.fixtureReplays, expectedFixtureReplays);
    ++rep.fails;
  }

  // Lab scenarios: set equality by name (expect.txt model).
  std::vector<std::string> wantLab;
  for (auto* s : kExpectedLabScenarios) wantLab.emplace_back(s);
  std::vector<std::string> gotLab = rep.labScenarios;
  std::sort(wantLab.begin(), wantLab.end());
  std::sort(gotLab.begin(), gotLab.end());
  if (gotLab != wantLab) {
    std::fprintf(stderr,
                 "FAIL phase7: lab scenario set mismatch (got %zu want %d)\n",
                 gotLab.size(), expectedLab);
    for (const auto& g : gotLab) {
      bool found = false;
      for (const auto& w : wantLab) {
        if (g == w) {
          found = true;
          break;
        }
      }
      if (!found) std::fprintf(stderr, "  unexpected: %s\n", g.c_str());
    }
    for (const auto& w : wantLab) {
      bool found = false;
      for (const auto& g : gotLab) {
        if (g == w) {
          found = true;
          break;
        }
      }
      if (!found) std::fprintf(stderr, "  missing: %s\n", w.c_str());
    }
    ++rep.fails;
  }

  if (rep.fails) {
    std::fprintf(stderr,
                 "phase7 FAIL (%d fails, %d fixtureReplays, %zu labScenarios)\n",
                 rep.fails, rep.fixtureReplays, rep.labScenarios.size());
  } else {
    std::printf("phase7 PASS (%d fixtureReplays, %zu labScenarios)\n",
                rep.fixtureReplays, rep.labScenarios.size());
  }
  return rep.fails;
}

}  // namespace speculum::phase7
