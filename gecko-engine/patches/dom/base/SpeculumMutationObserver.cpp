/* Speculum — minimal DOM mutation probe (producer spike). */
#include "SpeculumMutationObserver.h"

#include "SpeculumLog.h"
#include "SpeculumNodeSource.h"
#include "mozilla/RefPtr.h"
#include "mozilla/UniquePtrExtensions.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/ContentChild.h"
#include "mozilla/dom/Document.h"
#include "nsComponentManagerUtils.h"
#include "nsDebug.h"
#include "nsReadableUtils.h"
#include "nsTArray.h"
#include "speculum/Producer.h"
#include "speculum/Wire.h"

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
                    bool aBootstrap) {
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
}

}  // namespace

SpeculumMutationObserver::SpeculumMutationObserver(Document* aDocument,
                                                   uint32_t aContextId)
    : mDocument(aDocument),
      mState(mozilla::MakeUnique<SpeculumProducerState>(aContextId)) {}

SpeculumMutationObserver::~SpeculumMutationObserver() {
  CancelFrameTimer();
}

void SpeculumMutationObserver::CancelFrameTimer() {
  if (mState && mState->frameTimer) {
    mState->frameTimer->Cancel();
    mState->frameTimer = nullptr;
  }
}

void SpeculumMutationObserver::ArmFrameTimerIfNeeded() {
  if (!mState || mState->frameTimer) {
    return;
  }
  nsresult rv = NS_NewTimerWithCallback(getter_AddRefs(mState->frameTimer), this,
                                        16, nsITimer::TYPE_ONE_SHOT);
  if (NS_FAILED(rv)) {
    mState->frameTimer = nullptr;
  }
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
  const uint32_t ops = mState->producer.pendingOps();
  if (ops == 0) {
    return;
  }
  std::vector<uint8_t> frame = mState->producer.emitFrame();
  if (frame.empty()) {
    return;
  }
  SendFrameBytes(mDocument, *mState, frame, ops, false);
}

bool SpeculumMutationObserver::TryWriteBootstrapFrame() {
  if (!mDocument || !mDocument->IsContentDocument() || !mState) {
    return false;
  }
  mState->producer.bootstrap(mDocument);
  const uint32_t ops = mState->producer.pendingOps();
  std::vector<uint8_t> frame = mState->producer.emitFrame();
  if (frame.empty()) {
    return false;
  }
  SendFrameBytes(mDocument, *mState, frame, ops, true);
  return true;
}

void SpeculumMutationObserver::CharacterDataWillChange(
    nsIContent*, const CharacterDataChangeInfo&) {
  SPECULUM_LOG("CharacterDataWillChange");
}

void SpeculumMutationObserver::CharacterDataChanged(
    nsIContent* aContent, const CharacterDataChangeInfo&) {
  SPECULUM_LOG("CharacterDataChanged");
  if (!mState) {
    return;
  }
  mState->producer.onTextChanged(aContent);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::AttributeWillChange(mozilla::dom::Element*,
                                                   int32_t, nsAtom*,
                                                   AttrModType) {
  SPECULUM_LOG("AttributeWillChange");
}

void SpeculumMutationObserver::AttributeChanged(mozilla::dom::Element* aElement,
                                                int32_t, nsAtom* aAttribute,
                                                AttrModType,
                                                const nsAttrValue*) {
  SPECULUM_LOG("AttributeChanged");
  if (!mState) {
    return;
  }
  mState->producer.onAttrChanged(aElement,
                                 SpeculumObserverUtf8FromAtom(aAttribute));
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::AttributeSetToCurrentValue(
    mozilla::dom::Element*, int32_t, nsAtom*) {
  SPECULUM_LOG("AttributeSetToCurrentValue");
}

void SpeculumMutationObserver::ContentAppended(
    nsIContent* aFirstNewContent, const ContentAppendInfo&) {
  SPECULUM_LOG("ContentAppended");
  if (!mState || !aFirstNewContent) {
    return;
  }
  nsINode* parent = aFirstNewContent->GetParentNode();
  for (nsIContent* child = aFirstNewContent; child;
       child = child->GetNextSibling()) {
    mState->producer.onInserted(parent, child);
  }
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ContentInserted(nsIContent* aChild,
                                               const ContentInsertInfo&) {
  SPECULUM_LOG("ContentInserted");
  if (!mState || !aChild) {
    return;
  }
  mState->producer.onInserted(aChild->GetParentNode(), aChild);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ContentWillBeRemoved(
    nsIContent* aChild, const ContentRemoveInfo&) {
  SPECULUM_LOG("ContentWillBeRemoved");
  if (!mState || !aChild) {
    return;
  }
  mState->producer.onRemoved(aChild->GetParentNode(), aChild);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::NodeWillBeDestroyed(nsINode* aNode) {
  SPECULUM_LOG("NodeWillBeDestroyed");
  if (!mState) {
    return;
  }
  mState->producer.onDestroyed(aNode);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ParentChainChanged(nsIContent*) {
  SPECULUM_LOG("ParentChainChanged");
}

void SpeculumAttachMutationObserverToDocument(Document* aDocument) {
  if (!aDocument || aDocument->GetSpeculumMutationObserver()) {
    return;
  }
  // O registro do contexto projetado vem da própria BrowsingContext (campo
  // sincronizado, carimbado pelo pai no ContextCreate). O produtor não julga
  // documento: ele lê a aba em que o documento está.
  mozilla::dom::BrowsingContext* bc = aDocument->GetBrowsingContext();
  mozilla::dom::BrowsingContext* top = bc ? bc->Top() : nullptr;
  const uint64_t topId = top ? top->Id() : 0;
  const uint32_t ctx = top ? top->GetSpeculumContextId() : 0;

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
