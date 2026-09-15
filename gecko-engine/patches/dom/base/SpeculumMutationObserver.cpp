/* Speculum — minimal DOM mutation probe (producer spike). */
#include "SpeculumMutationObserver.h"

#include "SpeculumLog.h"
#include "SpeculumCaps.h"
#include "SpeculumNodeSource.h"
#include "SpeculumTelemetry.h"
#include "mozilla/RefPtr.h"
#include "mozilla/TimeStamp.h"
#include "mozilla/UniquePtrExtensions.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/ContentChild.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/Element.h"
#include "mozilla/dom/ShadowRoot.h"
#include "nsComponentManagerUtils.h"
#include "nsDebug.h"
#include "nsReadableUtils.h"
#include "nsTArray.h"
#include "nsThreadUtils.h"
#include "speculum/Producer.h"
#include "speculum/Wire.h"

#include <map>
#include <unistd.h>
#include <vector>

using mozilla::dom::ContentChild;
using mozilla::dom::Document;

mozilla::LazyLogModule gSpeculumLog("Speculum");

struct SpeculumProducerState {
  SpeculumNodeSource source;
  speculum::Producer producer;
  nsCOMPtr<nsITimer> frameTimer;
  const uint32_t contextId;

  explicit SpeculumProducerState(uint32_t aContextId)
      : producer(source, aContextId, 0), contextId(aContextId) {}
};

NS_IMPL_ISUPPORTS(SpeculumMutationObserver, nsIMutationObserver, nsITimerCallback)

namespace {

std::string SpeculumObserverUtf8FromAtom(const nsAtom* aAtom) {
  if (!aAtom) {
    return std::string();
  }
  nsAutoString tmp;
  aAtom->ToString(tmp);
  return std::string(NS_ConvertUTF16toUTF8(tmp).get());
}

void SendFrameBytes(mozilla::dom::Document* aDocument,
                    SpeculumProducerState& aState,
                    const std::vector<uint8_t>& aFrame, uint32_t aOps,
                    bool aBootstrap, uint32_t aBuildMs) {
  if (aFrame.empty() || !aDocument) {
    return;
  }
  const uint32_t seq = aState.producer.sequence();
  if (ContentChild* cc = ContentChild::GetSingleton()) {
    nsTArray<uint8_t> bytes;
    bytes.AppendElements(aFrame.data(), aFrame.size());
    cc->SendSpeculumFrame(aState.source.docToken(), aState.contextId, seq, bytes);
  }
  nsAutoCString uri("(null)");
  if (nsIURI* docUri = aDocument->GetDocumentURI()) {
    uri = docUri->GetSpecOrDefault();
  }
  if (aBootstrap) {
    SPECULUM_LOG("[SPECULUM-BOOT] pid=%d ctx=%u uri=%s ops=%u bytes=%zu",
                 static_cast<int>(getpid()), aState.contextId, uri.get(), aOps,
                 aFrame.size());
  } else {
    SPECULUM_LOG("[SPECULUM-TICK] ctx=%u seq=%u ops=%u bytes=%zu",
                 aState.contextId, seq, aOps, aFrame.size());
  }
  SpeculumEmitFrameEmitted(
      aState.contextId, seq, aState.producer.generation(),
      static_cast<uint32_t>(aFrame.size()), aOps,
      static_cast<uint32_t>(aState.producer.table().size()),
      static_cast<uint32_t>(aState.producer.identity().size()), aBuildMs, 0, 0,
      aBootstrap);
}

uint32_t BuildMsIfOn(const mozilla::TimeStamp& aStart) {
  if (!SpeculumEventsOn() || !SpeculumMetricsOn() || aStart.IsNull()) {
    return 0;
  }
  const double ms = (mozilla::TimeStamp::Now() - aStart).ToMilliseconds();
  return ms < 0 ? 0 : static_cast<uint32_t>(ms);
}

mozilla::TimeStamp StampIfOn() {
  if (SpeculumEventsOn() && SpeculumMetricsOn()) {
    return mozilla::TimeStamp::Now();
  }
  return mozilla::TimeStamp();
}

}  // namespace

namespace {

std::map<uint32_t, SpeculumMutationObserver*> gObserversByContext;

void RegisterObserver(uint32_t aContextId, SpeculumMutationObserver* aObserver) {
  gObserversByContext[aContextId] = aObserver;
}

void UnregisterObserver(uint32_t aContextId, SpeculumMutationObserver* aObserver) {
  auto it = gObserversByContext.find(aContextId);
  if (it != gObserversByContext.end() && it->second == aObserver) {
    gObserversByContext.erase(it);
  }
}

}  // namespace

SpeculumMutationObserver::SpeculumMutationObserver(Document* aDocument,
                                                   uint32_t aContextId)
    : mDocument(aDocument),
      mState(mozilla::MakeUnique<SpeculumProducerState>(aContextId)) {
  RegisterObserver(aContextId, this);
  if (mState) {
    mState->source.BindDocument(aDocument);
  }
}

SpeculumMutationObserver::~SpeculumMutationObserver() {
  if (mState) {
    UnregisterObserver(mState->contextId, this);
  }
  CancelFrameTimer();
}

uint32_t SpeculumMutationObserver::ContextId() const {
  return mState ? mState->contextId : 0;
}

uint32_t SpeculumMutationObserver::Sequence() const {
  return mState ? mState->producer.sequence() : 0;
}

uint32_t SpeculumMutationObserver::Generation() const {
  return mState ? mState->producer.generation() : 0;
}

uint64_t SpeculumMutationObserver::TableHash() const {
  return mState ? mState->producer.table().tableHash() : 0;
}

void SpeculumMutationObserver::SetHalted(bool aHalted) {
  if (!mState) {
    return;
  }
  mState->producer.setHalted(aHalted);
  if (aHalted) {
    CancelFrameTimer();
  } else {
    ArmFrameTimerIfNeeded();
  }
}

void SpeculumMutationObserver::FlushNow() {
  EmitPendingFrame();
}

bool SpeculumMutationObserver::SnapshotDump(std::vector<uint8_t>& aOut) const {
  if (!mState) {
    return false;
  }
  aOut = mState->producer.snapshotDump();
  return true;
}

void SpeculumMutationObserver::OnSheetAdded(void* aSheet) {
  if (!mState || !aSheet) {
    return;
  }
  mState->source.NoteSheet(aSheet);
  mState->producer.onSheetAdded(aSheet);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::OnSheetRemoved(void* aSheet) {
  if (!mState || !aSheet) {
    return;
  }
  mState->source.DropSheet(aSheet);
  mState->producer.onSheetRemoved(aSheet);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::OnRuleAdded(void* aSheet, void* aRule,
                                           const std::string& aText) {
  if (!mState || !aRule) {
    return;
  }
  mState->source.NoteRule(aSheet, aRule, aText);
  mState->producer.onRuleAdded(aSheet, aRule);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::OnRuleRemoved(void* aSheet, void* aRule) {
  if (!mState || !aRule) {
    return;
  }
  mState->source.DropRule(aRule);
  mState->producer.onRuleRemoved(aSheet, aRule);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::OnRuleChanged(void* aRule, const std::string& aText) {
  if (!mState || !aRule) {
    return;
  }
  mState->source.SetRuleText(aRule, aText);
  mState->producer.onRuleChanged(aRule);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::CancelFrameTimer() {
  if (mState && mState->frameTimer) {
    mState->frameTimer->Cancel();
    mState->frameTimer = nullptr;
  }
}

void SpeculumMutationObserver::MaybeObserveShadow(nsIContent* aChild) {
  mozilla::dom::Element* el = mozilla::dom::Element::FromNode(aChild);
  if (!el) {
    return;
  }
  mozilla::dom::ShadowRoot* sr = el->GetShadowRoot();
  if (!sr) {
    return;
  }
  sr->AddMutationObserver(this);
}

void SpeculumMutationObserver::ArmFrameTimerIfNeeded() {
  if (!mState || mState->frameTimer) {
    return;
  }
  if (mState->producer.halted()) {
    return;
  }
  // Relógio da sessão, não o da aba. Sem alvo explícito o Gecko usa
  // GetCurrentSerialEventTarget() — no callback de load/mutação isso é a
  // fila do DocGroup. Headless (e aba hidden) congela essa fila: o
  // bootstrap (síncrono) sai, o tick de 16 ms nunca dispara.
  nsISerialEventTarget* target = GetMainThreadSerialEventTarget();
  if (!target) {
    SPECULUM_LOG("[SPECULUM-TICK] arm ctx=%u sem main thread", mState->contextId);
    return;
  }
  nsresult rv = NS_NewTimerWithCallback(getter_AddRefs(mState->frameTimer), this,
                                        16, nsITimer::TYPE_ONE_SHOT, target);
  if (NS_FAILED(rv)) {
    SPECULUM_LOG("[SPECULUM-TICK] arm ctx=%u rv=%x", mState->contextId,
                 static_cast<unsigned>(rv));
    mState->frameTimer = nullptr;
    return;
  }
  SPECULUM_LOG("[SPECULUM-TICK] arm ctx=%u", mState->contextId);
}

NS_IMETHODIMP
SpeculumMutationObserver::Notify(nsITimer* aTimer) {
  if (!mState || aTimer != mState->frameTimer) {
    return NS_OK;
  }
  mState->frameTimer = nullptr;
  EmitPendingFrame();
  return NS_OK;
}

void SpeculumMutationObserver::EmitPendingFrame() {
  if (!mState) {
    return;
  }
  const mozilla::TimeStamp t0 = StampIfOn();
  std::vector<uint8_t> frame = mState->producer.emitFrame();
  if (frame.empty()) {
    SPECULUM_LOG("[SPECULUM-TICK] vazio ctx=%u seq=%u", mState->contextId,
                 mState->producer.sequence());
    return;
  }
  SendFrameBytes(mDocument, *mState, frame, mState->producer.lastEmittedOps(),
                 false, BuildMsIfOn(t0));
}

bool SpeculumMutationObserver::TryWriteBootstrapFrame() {
  if (!mDocument || !mDocument->IsContentDocument() || !mState) {
    return false;
  }
  mState->source.CaptureLiveCssom();
  const mozilla::TimeStamp t0 = StampIfOn();
  std::vector<uint8_t> frame = mState->producer.resyncVirtual(mDocument);
  if (frame.empty()) {
    return false;
  }
  SendFrameBytes(mDocument, *mState, frame, mState->producer.lastEmittedOps(), true,
                 BuildMsIfOn(t0));
  return true;
}

void SpeculumMutationObserver::RequestResync(uint8_t aForce) {
  if (!mDocument || !mState) {
    return;
  }
  SpeculumEmitBytes(mState->contextId, SpeculumCatalog::ResyncRequested, &aForce,
                    1);
  CancelFrameTimer();
  mState->producer.discardPending();
  mState->source.CaptureLiveCssom();
  std::vector<uint8_t> frame;
  const mozilla::TimeStamp t0 = StampIfOn();
  if (aForce == 1) {
    frame = mState->producer.resyncVirtual(mDocument);
  } else {
    frame = mState->producer.emitResyncFrame();
  }
  if (frame.empty()) {
    SPECULUM_LOG("[SPECULUM-RESYNC] ctx=%u force=%u vazio", mState->contextId,
                 aForce);
    SpeculumEmitResync(mState->contextId, aForce, false);
    return;
  }
  SendFrameBytes(mDocument, *mState, frame, mState->producer.lastEmittedOps(), true,
                 BuildMsIfOn(t0));
  SpeculumEmitResync(mState->contextId, aForce, true);
  SPECULUM_LOG("[SPECULUM-RESYNC] ctx=%u force=%u seq=%u bytes=%zu",
               mState->contextId, aForce, mState->producer.sequence(),
               frame.size());
}

void SpeculumRequestResync(uint32_t aContextId, uint8_t aForce) {
  auto it = gObserversByContext.find(aContextId);
  if (it == gObserversByContext.end() || !it->second) {
    SPECULUM_LOG("[SPECULUM-RESYNC] ctx=%u sem observer — no-op", aContextId);
    return;
  }
  it->second->RequestResync(aForce);
}

void SpeculumHaltClocks() {
  for (auto& kv : gObserversByContext) {
    if (kv.second) {
      kv.second->SetHalted(true);
    }
  }
}

void SpeculumResumeClocks() {
  for (auto& kv : gObserversByContext) {
    if (kv.second) {
      kv.second->SetHalted(false);
    }
  }
}

void SpeculumFlushFrame(uint32_t aContextId) {
  auto it = gObserversByContext.find(aContextId);
  if (it == gObserversByContext.end() || !it->second) {
    return;
  }
  it->second->FlushNow();
}

bool SpeculumSnapshotDump(uint32_t aContextId, std::vector<uint8_t>& aOut,
                          uint32_t* aSequence, uint32_t* aGeneration,
                          uint64_t* aTableHash) {
  auto it = gObserversByContext.find(aContextId);
  if (it == gObserversByContext.end() || !it->second) {
    return false;
  }
  if (!it->second->SnapshotDump(aOut)) {
    return false;
  }
  if (aSequence) {
    *aSequence = it->second->Sequence();
  }
  if (aGeneration) {
    *aGeneration = it->second->Generation();
  }
  if (aTableHash) {
    *aTableHash = it->second->TableHash();
  }
  return true;
}

mozilla::dom::Document* SpeculumDocumentForContext(uint32_t aContextId) {
  auto it = gObserversByContext.find(aContextId);
  if (it == gObserversByContext.end() || !it->second) {
    return nullptr;
  }
  return it->second->GetDocument();
}

const void* SpeculumMutationObserver::IdentityKey(uint32_t aNodeId) const {
  if (!mState) {
    return nullptr;
  }
  const speculum::IdentityKey key = mState->producer.identity().keyOf(aNodeId);
  if (!key.ptr || key.space != speculum::KeySpace::Node) {
    return nullptr;
  }
  return key.ptr;
}

nsINode* SpeculumNodeForId(uint32_t aContextId, uint32_t aNodeId) {
  auto it = gObserversByContext.find(aContextId);
  if (it == gObserversByContext.end() || !it->second) {
    return nullptr;
  }
  const void* key = it->second->IdentityKey(aNodeId);
  return const_cast<nsINode*>(static_cast<const nsINode*>(key));
}

void SpeculumMutationObserver::CharacterDataWillChange(
    nsIContent*, const CharacterDataChangeInfo&) {}

void SpeculumMutationObserver::CharacterDataChanged(
    nsIContent* aContent, const CharacterDataChangeInfo&) {
  if (!mState || !aContent || mState->source.isUaOwned(aContent)) {
    return;
  }
  mState->producer.onTextChanged(aContent);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::AttributeWillChange(mozilla::dom::Element*,
                                                   int32_t, nsAtom*,
                                                   AttrModType) {}

void SpeculumMutationObserver::AttributeChanged(mozilla::dom::Element* aElement,
                                                int32_t, nsAtom* aAttribute,
                                                AttrModType,
                                                const nsAttrValue*) {
  if (!mState || !aElement || mState->source.isUaOwned(aElement)) {
    return;
  }
  mState->producer.onAttrChanged(aElement,
                                 SpeculumObserverUtf8FromAtom(aAttribute));
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::AttributeSetToCurrentValue(
    mozilla::dom::Element*, int32_t, nsAtom*) {}

void SpeculumMutationObserver::ContentAppended(
    nsIContent* aFirstNewContent, const ContentAppendInfo&) {
  if (!mState || !aFirstNewContent) {
    return;
  }
  nsINode* parent = aFirstNewContent->GetParentNode();
  for (nsIContent* child = aFirstNewContent; child;
       child = child->GetNextSibling()) {
    if (mState->source.isUaOwned(child)) {
      continue;
    }
    mState->producer.onInserted(parent, child);
    MaybeObserveShadow(child);
  }
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ContentInserted(nsIContent* aChild,
                                               const ContentInsertInfo&) {
  if (!mState || !aChild || mState->source.isUaOwned(aChild)) {
    return;
  }
  mState->producer.onInserted(aChild->GetParentNode(), aChild);
  MaybeObserveShadow(aChild);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ContentWillBeRemoved(
    nsIContent* aChild, const ContentRemoveInfo&) {
  if (!mState || !aChild) {
    return;
  }
  mState->producer.onRemoved(aChild->GetParentNode(), aChild);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::NodeWillBeDestroyed(nsINode* aNode) {
  if (!mState) {
    return;
  }
  mState->producer.onDestroyed(aNode);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ParentChainChanged(nsIContent*) {}

void SpeculumAttachMutationObserverToDocument(Document* aDocument) {
  if (!aDocument || aDocument->GetSpeculumMutationObserver()) {
    return;
  }
  // C desta janela, não do Top(). Iframe mintado no CreateDetached traz o
  // próprio id; chrome / não projetado fica 0 e some.
  mozilla::dom::BrowsingContext* bc = aDocument->GetBrowsingContext();
  mozilla::dom::BrowsingContext* top = bc ? bc->Top() : nullptr;
  const uint64_t topId = top ? top->Id() : 0;
  const uint32_t ctx = bc ? bc->GetSpeculumContextId() : 0;

  // Um documento que não anexa é um documento que não projeta. A decisão é
  // observável: sem isto, "a página não subiu" não distingue registro ausente
  // de BrowsingContext ausente.
  if (!bc || bc->IsContent()) {
    nsAutoCString uri("(null)");
    if (nsIURI* docUri = aDocument->GetDocumentURI()) {
      uri = docUri->GetSpecOrDefault();
    }
    SPECULUM_LOG("[SPECULUM-ATTACH] pid=%d topBc=%llu ctx=%u uri=%s",
                 static_cast<int>(getpid()),
                 static_cast<unsigned long long>(topId), ctx, uri.get());
  }

  if (ctx == 0) {
    return;
  }
  RefPtr<SpeculumMutationObserver> obs =
      new SpeculumMutationObserver(aDocument, ctx);
  aDocument->SetSpeculumMutationObserver(obs.get());
  aDocument->AddMutationObserver(obs);
}

void SpeculumDetachMutationObserverFromDocument(Document* aDocument) {
  if (!aDocument) {
    return;
  }
  RefPtr<SpeculumMutationObserver> obs = aDocument->GetSpeculumMutationObserver();
  if (!obs) {
    return;
  }
  obs->CancelFrameTimer();
  aDocument->RemoveMutationObserver(obs);
  aDocument->SetSpeculumMutationObserver(nullptr);
}

void SpeculumBindLiveDocument(Document* aDocument) {
  if (!aDocument) {
    return;
  }
  SpeculumMutationObserver* obs = aDocument->GetSpeculumMutationObserver();
  if (!obs || obs->ContextId() == 0) {
    return;
  }
  RegisterObserver(obs->ContextId(), obs);
}
