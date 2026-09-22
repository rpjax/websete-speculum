// Phase 3 acceptance — engine sim / documents / composition (A1–A7).
#include <cstdio>
#include <string>
#include <vector>

#include "domain/documents/Documents.hpp"
#include "domain/documents/Hosts.hpp"
#include "domain/documents/NavigationState.hpp"
#include "domain/documents/Viewports.hpp"
#include "engines/sim/SimEngine.hpp"
#include "host/Composition.hpp"
#include "ports/IEngineObserver.hpp"

using namespace speculum;
using namespace speculum::sim;

static int g_fails = 0;
#define CHECK(c, m)                                                            \
  do {                                                                         \
    if (!(c)) {                                                                \
      std::fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, m);          \
      ++g_fails;                                                               \
    }                                                                          \
  } while (0)

static std::vector<EffectKind> kindsOf(const EffectLog& log) {
  std::vector<EffectKind> k;
  for (const auto& e : log.items()) k.push_back(e.kind);
  return k;
}

static void runNavScript(SimEngine& eng, HostId host) {
  eng.effects().clear();
  CHECK(eng.doNavigate(host, "https://example.test/a", 1).ok(), "nav1");
  eng.emitLoadStarted(host);
  eng.emitLocation(host, "https://example.test/a");
  eng.emitLoadStopped(host, true);
  CHECK(eng.checkInvariants(), "inv after script");
}

// A1 — same script at root and depth-3 → same effect kind sequence
static void test_hosts_no_root_special_case() {
  SimEngine eng;
  HostId root{};
  eng.openViewport(Extent{800, 600}, &root);
  runNavScript(eng, root);
  auto rootKinds = kindsOf(eng.effects());

  SimEngine eng2;
  HostId r2{};
  eng2.openViewport(Extent{800, 600}, &r2);
  HostId c1 = eng2.attachChildHost(r2, Extent{400, 300});
  HostId c2 = eng2.attachChildHost(c1, Extent{400, 300});
  HostId deep = eng2.attachChildHost(c2, Extent{400, 300});
  runNavScript(eng2, deep);
  auto deepKinds = kindsOf(eng2.effects());

  CHECK(rootKinds.size() == deepKinds.size(), "A1 size");
  CHECK(rootKinds == deepKinds, "A1 effects_root == effects_deep");
}

// A2 — three viewports, distinct trees, same code path
static void test_three_viewports_same_code() {
  SimEngine eng;
  HostId a{}, b{}, c{};
  auto va = eng.openViewport(Extent{100, 100}, &a);
  auto vb = eng.openViewport(Extent{200, 200}, &b);
  auto vc = eng.openViewport(Extent{300, 300}, &c);
  CHECK(va.ok() && vb.ok() && vc.ok(), "open x3");
  CHECK(eng.viewports().size() == 3, "3 viewports");
  CHECK(a != b && b != c && a != c, "distinct roots");

  eng.attachChildHost(a, Extent{50, 50});
  eng.attachChildHost(b, Extent{50, 50});
  eng.attachChildHost(b, Extent{50, 50});
  // no child on c

  CHECK(eng.doNavigate(a, "https://a.test", 0).ok(), "nav a");
  CHECK(eng.doNavigate(b, "https://b.test", 0).ok(), "nav b");
  CHECK(eng.doNavigate(c, "https://c.test", 0).ok(), "nav c");
  CHECK(eng.frame(a) && eng.frame(b) && eng.frame(c), "frames");
  CHECK(eng.checkInvariants(), "A2 invariants");
}

// A3 — kill process with 3 docs (2 with children in another process)
static void test_process_kill_three_docs_order() {
  SimEngine eng;
  HostId r{};
  eng.openViewport(Extent{800, 600}, &r);
  HostId d1 = r;
  HostId d2 = eng.attachChildHost(d1, Extent{100, 100});
  HostId d3 = eng.attachChildHost(d1, Extent{100, 100});
  HostId d2child = eng.attachChildHost(d2, Extent{40, 40});
  HostId d3child = eng.attachChildHost(d3, Extent{40, 40});

  CHECK(eng.doNavigate(d1, "https://d1", 0).ok(), "d1");
  CHECK(eng.doNavigate(d2, "https://d2", 0).ok(), "d2");
  CHECK(eng.doNavigate(d3, "https://d3", 0).ok(), "d3");
  CHECK(eng.doNavigate(d2child, "https://d2c", 0).ok(), "d2c");
  CHECK(eng.doNavigate(d3child, "https://d3c", 0).ok(), "d3c");

  ProcessId p1 = eng.documents().find(eng.documentOf(d1)->id())->process;
  ProcessId pc2 = eng.documents().find(eng.documentOf(d2child)->id())->process;
  ProcessId pc3 = eng.documents().find(eng.documentOf(d3child)->id())->process;
  CHECK(pc2 != p1 && pc3 != p1, "children other process");

  eng.bindDocumentToProcess(d2, p1);
  eng.bindDocumentToProcess(d3, p1);
  CHECK(eng.documents().find(eng.documentOf(d2)->id())->process == p1, "d2 on p1");
  CHECK(eng.documents().find(eng.documentOf(d3)->id())->process == p1, "d3 on p1");

  eng.effects().clear();
  struct Obs : IEngineObserver {
    int gone = 0;
    void onProcessGone(const IEngineProcess&) override { ++gone; }
  } obs;
  eng.attach(&obs);

  eng.killProcess(p1);

  int discards = 0, gone = 0;
  int processGoneIdx = -1, lastDiscardIdx = -1;
  const auto& items = eng.effects().items();
  for (size_t i = 0; i < items.size(); ++i) {
    if (items[i].kind == EffectKind::DocDiscarded) {
      ++discards;
      lastDiscardIdx = int(i);
    }
    if (items[i].kind == EffectKind::ProcessGone) {
      ++gone;
      processGoneIdx = int(i);
    }
  }
  CHECK(discards == 3, "A3 three discards");
  CHECK(gone == 1, "A3 one process gone");
  CHECK(processGoneIdx > lastDiscardIdx, "A3 onProcessGone after docs");
  CHECK(obs.gone == 1, "observer gone");
  CHECK(eng.documentOf(d1) == nullptr, "d1 gone");
  CHECK(eng.frame(d2child) == nullptr, "subtree child closed");

  std::vector<DocumentId> seen;
  for (const auto& e : items) {
    if (e.kind != EffectKind::DocDiscarded) continue;
    for (auto s : seen) CHECK(!(s == e.doc), "A3 no duplicate discard");
    seen.push_back(e.doc);
  }
}

// A4 — NavigationState table + adversarial
static void test_nav_table_eight_rows() {
  {
    NavigationState n;
    auto r = n.apply({NavEventKind::Requested, 1});
    CHECK(n.phase() == NavPhase::Requested && r.effect == NavEffect::None, "row1");
  }
  {
    NavigationState n;
    n.apply({NavEventKind::Requested, 1});
    auto r = n.apply({NavEventKind::LoadStarted, 0});
    CHECK(n.phase() == NavPhase::Started && r.effect == NavEffect::EmitLoadStart, "row2");
  }
  {
    NavigationState n;
    n.apply({NavEventKind::Requested, 1});
    auto r = n.apply({NavEventKind::LoadStoppedOk, 0});
    CHECK(n.phase() == NavPhase::Requested && r.effect == NavEffect::None, "row3");
  }
  {
    NavigationState n;
    n.apply({NavEventKind::Requested, 1});
    n.apply({NavEventKind::LoadStarted, 0});
    auto r = n.apply({NavEventKind::LocationChanged, 0});
    CHECK(n.phase() == NavPhase::Started && r.effect == NavEffect::None, "row4");
  }
  {
    NavigationState n;
    n.apply({NavEventKind::Requested, 1});
    n.apply({NavEventKind::LoadStarted, 0});
    auto r = n.apply({NavEventKind::LoadStoppedOk, 0});
    CHECK(n.phase() == NavPhase::Committed && r.effect == NavEffect::EmitNavigated,
          "row5");
  }
  {
    NavigationState n;
    n.apply({NavEventKind::Requested, 1});
    n.apply({NavEventKind::LoadStarted, 0});
    auto r = n.apply({NavEventKind::LoadStoppedFail, 0});
    CHECK(n.phase() == NavPhase::Failed && r.effect == NavEffect::EmitFailed, "row6");
  }
  {
    NavigationState n;
    n.apply({NavEventKind::Requested, 1});
    n.apply({NavEventKind::LoadStarted, 0});
    n.apply({NavEventKind::LoadStoppedOk, 0});
    auto r = n.apply({NavEventKind::LoadStarted, 0});
    CHECK(n.phase() == NavPhase::Started && r.effect == NavEffect::EmitLoadStart, "row7");
  }
  {
    NavigationState n;
    n.apply({NavEventKind::Requested, 1});
    n.apply({NavEventKind::LoadStarted, 0});
    auto r = n.apply({NavEventKind::Requested, 2});
    CHECK(n.phase() == NavPhase::Requested && r.effect == NavEffect::Cancelled, "row8");
    CHECK(r.cancelled == 1, "cancelled corr");
  }
}

static void test_nav_stop_after_new_start() {
  NavigationState n;
  n.apply({NavEventKind::Requested, 1});
  n.apply({NavEventKind::LoadStarted, 0});
  // new request cancels
  n.apply({NavEventKind::Requested, 2});
  // STOP of previous while Requested
  auto r = n.apply({NavEventKind::LoadStoppedOk, 0});
  CHECK(r.effect == NavEffect::None && n.phase() == NavPhase::Requested,
        "stop after new start");
}

static void test_nav_location_without_start() {
  static int local = 0;
  local = 0;
  g_navIllegalHook = [](NavPhase, NavEventKind) { ++local; };
  NavigationState n;
  n.apply({NavEventKind::Requested, 1});
  n.apply({NavEventKind::LocationChanged, 0});  // illegal in Requested
  CHECK(local == 1, "location without start illegal");
  g_navIllegalHook = nullptr;
}

static void test_nav_start_stop_start() {
  NavigationState n;
  n.apply({NavEventKind::Requested, 1});
  n.apply({NavEventKind::LoadStarted, 0});
  n.apply({NavEventKind::LoadStoppedOk, 0});
  CHECK(n.phase() == NavPhase::Committed, "committed");
  n.apply({NavEventKind::LoadStarted, 0});
  CHECK(n.phase() == NavPhase::Started, "start again");
}

static void test_nav_second_navigate_cancels_correlation() {
  SimEngine eng;
  HostId root{};
  eng.openViewport(Extent{800, 600}, &root);
  CHECK(eng.doNavigate(root, "https://a", 10).ok(), "first");
  CHECK(eng.correlations().pending() == 1, "pending 1");
  CHECK(eng.doNavigate(root, "https://b", 11).ok(), "second");
  // first cancelled via take; second remembered
  CHECK(eng.correlations().pending() == 1, "pending only second");
  bool found11 = false, found10 = false;
  for (const auto& p : eng.correlations().items()) {
    if (p.id == 11) found11 = true;
    if (p.id == 10) found10 = true;
  }
  CHECK(found11 && !found10, "second live, first gone");
}

static void test_nav_illegal_transition_asserts() {
  static int hits = 0;
  hits = 0;
  g_navIllegalHook = [](NavPhase, NavEventKind) { ++hits; };
  NavigationState n;
  // Idle + LoadStarted = illegal
  n.apply({NavEventKind::LoadStarted, 0});
  CHECK(hits == 1, "illegal once");
  g_navIllegalHook = nullptr;
}

// A6 — invariants on command boundary
static void test_hosts_documents_invariants_on_boundary() {
  SimEngine eng;
  HostId root{};
  eng.openViewport(Extent{800, 600}, &root);
  CHECK(eng.checkInvariants(), "after open");
  HostId child = eng.attachChildHost(root, Extent{100, 100});
  CHECK(eng.checkInvariants(), "after attach");
  eng.doNavigate(root, "https://x", 1);
  CHECK(eng.checkInvariants(), "after nav root");
  eng.doNavigate(child, "https://y", 2);
  CHECK(eng.checkInvariants(), "after nav child");
  eng.emitLoadStarted(root);
  eng.emitLocation(root, "https://x");
  eng.emitLoadStopped(root, true);
  CHECK(eng.checkInvariants(), "after load");
  eng.closeViewport(eng.viewports().find(eng.hosts().find(root)->viewport)->id);
  // after close, empty ok
}

// A7 — composition root
static void test_composition_root_no_null_ports() {
  Composition c;
  CHECK(c.portsNonNull(), "ports");
  CHECK(&c.link() != nullptr, "link");
  CHECK(&c.clock() != nullptr, "clock");
  CHECK(&c.engine() != nullptr, "engine");
  CHECK(&c.session() != nullptr, "session");
  c.establish();
  CHECK(c.session().phase() == session::Phase::Ready, "ready");
  HostId root{};
  auto vr = c.sim().openViewport(Extent{640, 480}, &root);
  CHECK(vr.ok() && root.valid(), "open");
  CHECK(c.sim().doNavigate(root, "https://compose.test", 42).ok(), "navigate");
  CHECK(c.sim().frame(root) != nullptr, "frame");
  CHECK(c.sim().documentOf(root) != nullptr, "doc");
  CHECK(c.sim().checkInvariants(), "inv");
}

int main() {
  test_nav_table_eight_rows();
  test_nav_stop_after_new_start();
  test_nav_location_without_start();
  test_nav_start_stop_start();
  test_nav_second_navigate_cancels_correlation();
  test_nav_illegal_transition_asserts();
  test_hosts_no_root_special_case();
  test_three_viewports_same_code();
  test_process_kill_three_docs_order();
  test_hosts_documents_invariants_on_boundary();
  test_composition_root_no_null_ports();

  if (g_fails) {
    std::fprintf(stderr, "phase3 FAIL (%d)\n", g_fails);
    return 1;
  }
  std::printf("phase3 PASS\n");
  return 0;
}
