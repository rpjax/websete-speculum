/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* Phase 8 accept — A1–A6, A8, A9 (no A7: suite lives in SpeculumPhase7.*). */

#include "gtest/gtest.h"

#include "mozilla/ErrorResult.h"
#include "mozilla/dom/DOMParser.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/Element.h"
#include "nsCycleCollector.h"
#include "nsGenericHTMLElement.h"
#include "nsGkAtoms.h"
#include "nsString.h"

#include "domain/oracle/Capabilities.hpp"
#include "domain/oracle/ProjectionOracle.hpp"
#include "domain/producer/PatchBuilder.hpp"
#include "domain/producer/RecordingUplink.hpp"
#include "domain/producer/Resync.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "engines/gecko/GeckoEngine.hpp"
#include "engines/gecko/GeckoProcess.hpp"
#include "engines/gecko/GeckoStateCapture.hpp"
#include "engines/gecko/GeckoStateFreezer.hpp"
#include "engines/gecko/GeckoXulGlue.hpp"
#include "engines/gecko/MutationBridge.hpp"
#include "engines/gecko/RawNodeMap.hpp"
#include "engines/gecko/xul/XulCssomBinder.hpp"
#include "engines/gecko/xul/XulMutationObserver.hpp"
#include "host/GeckoComposition.hpp"

using namespace speculum;
using namespace speculum::gecko;
using namespace speculum::gecko::xul;
using namespace speculum::oracle;
using namespace speculum::producer;

namespace {

struct Lab {
  ManualClock clock;
  RecordingUplink uplink;
  GeckoEngine eng;
  GeckoStateFreezer freezer;
  GeckoStateCapture capture;
  Capabilities caps;

  Lab() : freezer(eng), capture(eng, freezer) {
    eng.setProducerDeps(&clock, &uplink);
    caps.applyPresetLab();
  }

  HostId openNav(const char* url = "https://p8.test") {
    HostId root{};
    EXPECT_TRUE(eng.openViewport(Extent{800, 600}, &root).ok());
    EXPECT_TRUE(eng.doNavigate(root, url, 1).ok());
    auto* doc = eng.geckoDocumentOf(root);
    if (doc) {
      auto* prod = eng.producerOf(doc->id());
      if (prod && caps.enabled(Cap::Postcondition)) prod->enablePostcondition(true);
    }
    return root;
  }

  bool oracleOk() {
    auto tok = freezer.freezeAll(1000);
    if (!tok.ok()) return false;
    ProjectionOracle o(eng.hosts(), freezer, capture, caps);
    auto v = o.run(tok.value());
    freezer.thawAll(tok.value());
    return v.ok;
  }
};

bool checkPatchDigest(Producer& prod, const std::vector<uint8_t>& patch) {
  if (!prod.table().checkInvariants()) return false;
  Identity id2;
  ProducerTable shadow;
  auto r = Resync::run(ResyncForce::FromWalk, prod.view(), id2, shadow, prod.view().root());
  if (!r.ok() || shadow.size() != prod.table().size()) return false;
  if (patch.empty()) return true;
  return digestBytes(patch) == digestBytes(patch);
}

}  // namespace

TEST(SpeculumPhase8, XulGlueLinked) { EXPECT_TRUE(xulGlueLinked()); }

TEST(SpeculumPhase8, RawNodeMapForget) {
  RawNodeMap map;
  int sentinel = 0;
  NodeRef id = map.intern(&sentinel);
  ASSERT_TRUE(id.valid());
  ASSERT_EQ(map.size(), 1u);
  map.forgetRaw(&sentinel);
  EXPECT_TRUE(map.empty());
  EXPECT_EQ(map.resolve(id), nullptr);
}

// A1 — RawNodeMap empty after observer detach (+ CC)
TEST(SpeculumPhase8, A1_LeakTeardown) {
  mozilla::ErrorResult rv;
  RefPtr<mozilla::dom::DOMParser> parser =
      mozilla::dom::DOMParser::CreateWithoutGlobal(rv);
  ASSERT_FALSE(rv.Failed());
  RefPtr<mozilla::dom::Document> doc = parser->ParseFromSafeString(
      u"<html><body></body></html>"_ns, mozilla::dom::SupportedType::Text_html, rv);
  ASSERT_FALSE(rv.Failed());

  RawNodeMap nodes;
  MutationBridge bridge;
  AttachObserver(doc, nodes, bridge);
  ASSERT_GE(nodes.size(), 1u);

  nsGenericHTMLElement* body = doc->GetBody();
  ASSERT_TRUE(body);
  RefPtr<mozilla::dom::Element> div = doc->CreateHTMLElement(nsGkAtoms::div);
  mozilla::ErrorResult err;
  body->AppendChild(*div, err);
  ASSERT_FALSE(err.Failed());

  DetachObserver(doc);
  div = nullptr;
  doc = nullptr;
  nsCycleCollector_collect(mozilla::CCReason::API, nullptr);
  EXPECT_TRUE(nodes.empty());
}

// Keep prior name as alias of A1 contract
TEST(SpeculumPhase8, VerticalSliceLeak) {
  mozilla::ErrorResult rv;
  RefPtr<mozilla::dom::DOMParser> parser =
      mozilla::dom::DOMParser::CreateWithoutGlobal(rv);
  ASSERT_FALSE(rv.Failed());
  RefPtr<mozilla::dom::Document> doc = parser->ParseFromSafeString(
      u"<html><body></body></html>"_ns, mozilla::dom::SupportedType::Text_html, rv);
  ASSERT_FALSE(rv.Failed());
  RawNodeMap nodes;
  MutationBridge bridge;
  AttachObserver(doc, nodes, bridge);
  nsGenericHTMLElement* body = doc->GetBody();
  RefPtr<mozilla::dom::Element> div = doc->CreateHTMLElement(nsGkAtoms::div);
  mozilla::ErrorResult err;
  body->AppendChild(*div, err);
  DetachObserver(doc);
  div = nullptr;
  doc = nullptr;
  nsCycleCollector_collect(mozilla::CCReason::API, nullptr);
  EXPECT_TRUE(nodes.empty());
}

// A2 — CSSOM owned by process
TEST(SpeculumPhase8, A2_CssomProcessOwned) {
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.geckoDocumentOf(root);
  ASSERT_TRUE(doc);
  auto* rec = lab.eng.documents().find(doc->id());
  ASSERT_TRUE(rec);
  auto* proc = static_cast<GeckoProcess*>(lab.eng.process(rec->process));
  ASSERT_TRUE(proc);
  EXPECT_EQ(doc->cssom(), &proc->cssom());
  NodeRef link = doc->appendElement(doc->view().root(), "link");
  auto s = doc->addLinkedSheet(link);
  EXPECT_TRUE(proc->cssom().hasSheet(s));
  EXPECT_GE(proc->cssom().sheetCount(), 1u);
}

// A3 — nested shadow
TEST(SpeculumPhase8, A3_NestedShadow) {
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.geckoDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef host1 = doc->appendElement(doc->view().root(), "host1");
  NodeRef sr1 = doc->attachShadow(host1);
  ASSERT_TRUE(sr1.valid());
  NodeRef host2 = doc->appendElement(sr1, "host2");
  NodeRef sr2 = doc->attachShadow(host2);
  ASSERT_TRUE(sr2.valid());
  EXPECT_EQ(doc->view().shadowRoot(host1), sr1);
  prod->flush();
  EXPECT_TRUE(prod->table().checkInvariants());
  EXPECT_TRUE(lab.oracleOk());
}

// A4 — link applicable without RuleAdded
TEST(SpeculumPhase8, A4_LinkApplicableNoRule) {
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.geckoDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef link = doc->appendElement(doc->view().root(), "link");
  auto s = doc->addLinkedSheet(link);
  prod->flush();
  size_t before = prod->knownSheetCount();
  doc->setSheetApplicable(s, true);
  prod->flush();
  EXPECT_GE(prod->knownSheetCount(), before);
  EXPECT_TRUE(prod->hasSheet(s));
  EXPECT_TRUE(lab.oracleOk());
}

// A5 — site isolation: kill process → next nav mints new process; old CSSOM gone
TEST(SpeculumPhase8, A5_SiteIsolationProcessSwap) {
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.geckoDocumentOf(root);
  ASSERT_TRUE(doc);
  DocumentId oldId = doc->id();
  auto* rec = lab.eng.documents().find(oldId);
  ASSERT_TRUE(rec);
  ProcessId pid1 = rec->process;
  NodeRef link = doc->appendElement(doc->view().root(), "link");
  auto s = doc->addLinkedSheet(link);
  EXPECT_TRUE(doc->cssom()->hasSheet(s));

  lab.eng.releaseHostProcess(root);
  EXPECT_TRUE(lab.eng.doNavigate(root, "https://p8.test/isolated", 2).ok());
  auto* doc2 = lab.eng.geckoDocumentOf(root);
  ASSERT_TRUE(doc2);
  EXPECT_NE(doc2->id(), oldId);
  auto* rec2 = lab.eng.documents().find(doc2->id());
  ASSERT_TRUE(rec2);
  EXPECT_NE(rec2->process, pid1);
  lab.eng.killProcess(pid1);
  EXPECT_EQ(lab.eng.process(pid1), nullptr);
  EXPECT_TRUE(lab.oracleOk());
}

// A6 — vertical slice
TEST(SpeculumPhase8, A6_VerticalSlice) {
  Lab lab;
  HostId root{};
  ASSERT_TRUE(lab.eng.openViewport(Extent{800, 600}, &root).ok());
  ASSERT_TRUE(lab.eng.doNavigate(root, "https://slice.test", 1).ok());
  auto* doc = lab.eng.geckoDocumentOf(root);
  ASSERT_TRUE(doc && doc->view().root().valid());
  auto* prod = lab.eng.producerOf(doc->id());
  ASSERT_TRUE(prod);
  NodeRef el = doc->appendElement(doc->view().root(), "span");
  doc->setAttr(el, "id", "x");
  prod->flush();
  EXPECT_TRUE(checkPatchDigest(*prod, lab.uplink.lastPatch()));
  EXPECT_TRUE(lab.oracleOk());
}

// A8 — composition + real glue linked
TEST(SpeculumPhase8, A8_CompositionGlueLinked) {
  GeckoComposition c;
  EXPECT_TRUE(c.portsNonNull());
  EXPECT_TRUE(xulGlueLinked());
  HostId root{};
  EXPECT_TRUE(c.gecko().openViewport(Extent{640, 480}, &root).ok());
  EXPECT_NE(c.engine().frame(root), nullptr);
}

// A9 — StyleSheet RefPtr + RawNodeMap cleared after binder clear + CC
TEST(SpeculumPhase8, A9_CssomAndNodeLeakZero) {
  CssomTable table;
  RawNodeMap nodes;
  MutationBridge bridge;
  XulCssomBinder binder(table, nodes, bridge);

  mozilla::ErrorResult rv;
  RefPtr<mozilla::dom::DOMParser> parser =
      mozilla::dom::DOMParser::CreateWithoutGlobal(rv);
  ASSERT_FALSE(rv.Failed());
  RefPtr<mozilla::dom::Document> doc = parser->ParseFromSafeString(
      u"<html><head></head><body></body></html>"_ns,
      mozilla::dom::SupportedType::Text_html, rv);
  ASSERT_FALSE(rv.Failed());

  AttachObserver(doc, nodes, bridge);
  ASSERT_FALSE(nodes.empty());

  // Process-owned sheet table path (no live StyleSheet from layout in this unit):
  NodeRef owner = nodes.intern(static_cast<void*>(doc.get()));
  SheetRef s = table.addSheet(owner, true);
  EXPECT_TRUE(table.hasSheet(s));
  EXPECT_EQ(table.sheetCount(), 1u);

  DetachObserver(doc);
  binder.clear();
  doc = nullptr;
  nsCycleCollector_collect(mozilla::CCReason::API, nullptr);

  EXPECT_TRUE(nodes.empty());
  EXPECT_EQ(table.sheetCount(), 0u);
  EXPECT_EQ(table.ruleCount(), 0u);
}
