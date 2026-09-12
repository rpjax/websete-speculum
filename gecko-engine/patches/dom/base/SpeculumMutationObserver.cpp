/* Speculum — minimal DOM mutation probe (producer spike). */
#include "SpeculumMutationObserver.h"

#include "mozilla/dom/ContentChild.h"
#include "mozilla/dom/Document.h"
#include "nsComponentManagerUtils.h"
#include "nsDebug.h"
#include "nsReadableUtils.h"
#include "nsTArray.h"
#include "nsITimer.h"

#include <cstdio>
#include <vector>

using mozilla::dom::ContentChild;
using mozilla::dom::Document;

NS_IMPL_ISUPPORTS(SpeculumMutationObserver, nsIMutationObserver, nsITimerCallback)

#define SPECULUM_LOG(cb) printf_stderr("[SPECULUM] %s\n", cb)

namespace {

std::string Utf8FromAtom(const nsAtom* aAtom) {
  if (!aAtom) {
    return std::string();
  }
  nsAutoString tmp;
  aAtom->ToString(tmp);
  return std::string(NS_ConvertUTF16toUTF8(tmp).get());
}

uint32_t NextSpeculumFrameIndex() {
  static uint32_t sNext = 0;
  return sNext++;
}

}  // namespace

SpeculumMutationObserver::SpeculumMutationObserver(Document* aDocument)
    : mDocument(aDocument),
      mProducer(mSource, speculum::kContextIdRoot, 0) {}

SpeculumMutationObserver::~SpeculumMutationObserver() {
  CancelFrameTimer();
}

void SpeculumMutationObserver::CancelFrameTimer() {
  if (mFrameTimer) {
    mFrameTimer->Cancel();
    mFrameTimer = nullptr;
  }
}

void SpeculumMutationObserver::ArmFrameTimerIfNeeded() {
  if (mFrameTimer) {
    return;
  }
  nsresult rv = NS_NewTimerWithCallback(getter_AddRefs(mFrameTimer), this, 16,
                                        nsITimer::TYPE_ONE_SHOT);
  if (NS_FAILED(rv)) {
    mFrameTimer = nullptr;
  }
}

NS_IMETHODIMP
SpeculumMutationObserver::Notify(nsITimer* aTimer) {
  if (aTimer != mFrameTimer) {
    return NS_OK;
  }
  mFrameTimer = nullptr;
  EmitPendingFrame();
  return NS_OK;
}

void SpeculumMutationObserver::SendFrameBytes(const std::vector<uint8_t>& aFrame,
                                              uint32_t aOps, bool aBootstrap) {
  if (aFrame.empty() || !mDocument) {
    return;
  }
  constexpr uint32_t kContextId = speculum::kContextIdRoot;
  const uint32_t seq = mProducer.sequence();
  if (ContentChild* cc = ContentChild::GetSingleton()) {
    nsTArray<uint8_t> bytes;
    bytes.AppendElements(aFrame.data(), aFrame.size());
    cc->SendSpeculumFrame(mSource.docToken(), kContextId, seq, bytes);
  }
  nsAutoCString uri("(null)");
  if (nsIURI* docUri = mDocument->GetDocumentURI()) {
    uri = docUri->GetSpecOrDefault();
  }
  if (aBootstrap) {
    printf_stderr("[SPECULUM-BOOT] pid=%d ctx=%u uri=%s ops=%u bytes=%zu\n",
                  static_cast<int>(getpid()), kContextId, uri.get(), aOps,
                  aFrame.size());
    mkdir("/tmp/speculum-frames", 0777);
    const uint32_t index = NextSpeculumFrameIndex();
    char binPath[128];
    (void)snprintf(binPath, sizeof(binPath), "/tmp/speculum-frames/frame_%u.bin",
                   index);
    if (FILE* fp = fopen(binPath, "wb")) {
      (void)fwrite(aFrame.data(), 1, aFrame.size(), fp);
      fclose(fp);
    }
    if (FILE* fp = fopen("/tmp/speculum-frames/frames.txt", "a")) {
      char line[64];
      const int lineLen =
          snprintf(line, sizeof(line), "frame_%u.bin\n", index);
      if (lineLen > 0) {
        (void)fwrite(line, 1, static_cast<size_t>(lineLen), fp);
      }
      fclose(fp);
    }
    printf_stderr(
        "[SPECULUM] bootstrap frame_%u bytes=%zu tableHash=%llu\n", index,
        aFrame.size(),
        static_cast<unsigned long long>(mProducer.table().tableHash()));
  } else {
    printf_stderr("[SPECULUM-TICK] ctx=%u seq=%u ops=%u bytes=%zu\n", kContextId,
                  seq, aOps, aFrame.size());
  }
}

void SpeculumMutationObserver::EmitPendingFrame() {
  const uint32_t ops = mProducer.pendingOps();
  if (ops == 0) {
    return;
  }
  std::vector<uint8_t> frame = mProducer.emitFrame();
  if (frame.empty()) {
    return;
  }
  SendFrameBytes(frame, ops, false);
}

bool SpeculumMutationObserver::TryWriteBootstrapFrame() {
  if (!mDocument || !mDocument->IsContentDocument()) {
    return false;
  }
  mProducer.bootstrap(mDocument);
  const uint32_t ops = mProducer.pendingOps();
  std::vector<uint8_t> frame = mProducer.emitFrame();
  if (frame.empty()) {
    return false;
  }
  SendFrameBytes(frame, ops, true);
  return true;
}

void SpeculumMutationObserver::CharacterDataWillChange(
    nsIContent*, const CharacterDataChangeInfo&) {
  SPECULUM_LOG("CharacterDataWillChange");
}

void SpeculumMutationObserver::CharacterDataChanged(
    nsIContent* aContent, const CharacterDataChangeInfo&) {
  SPECULUM_LOG("CharacterDataChanged");
  mProducer.onTextChanged(aContent);
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
  mProducer.onAttrChanged(aElement, Utf8FromAtom(aAttribute));
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::AttributeSetToCurrentValue(
    mozilla::dom::Element*, int32_t, nsAtom*) {
  SPECULUM_LOG("AttributeSetToCurrentValue");
}

void SpeculumMutationObserver::ContentAppended(
    nsIContent* aFirstNewContent, const ContentAppendInfo&) {
  SPECULUM_LOG("ContentAppended");
  if (!aFirstNewContent) {
    return;
  }
  nsINode* parent = aFirstNewContent->GetParentNode();
  for (nsIContent* child = aFirstNewContent; child;
       child = child->GetNextSibling()) {
    mProducer.onInserted(parent, child);
  }
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ContentInserted(nsIContent* aChild,
                                               const ContentInsertInfo&) {
  printf_stderr("[SPECULUM] wire ok, prefix=%zu\n", speculum::kFramePrefixBytes);
  SPECULUM_LOG("ContentInserted");
  if (!aChild) {
    return;
  }
  mProducer.onInserted(aChild->GetParentNode(), aChild);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ContentWillBeRemoved(
    nsIContent* aChild, const ContentRemoveInfo&) {
  SPECULUM_LOG("ContentWillBeRemoved");
  if (!aChild) {
    return;
  }
  mProducer.onRemoved(aChild->GetParentNode(), aChild);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::NodeWillBeDestroyed(nsINode* aNode) {
  SPECULUM_LOG("NodeWillBeDestroyed");
  mProducer.onDestroyed(aNode);
  ArmFrameTimerIfNeeded();
}

void SpeculumMutationObserver::ParentChainChanged(nsIContent*) {
  SPECULUM_LOG("ParentChainChanged");
}

void SpeculumAttachMutationObserverToDocument(Document* aDocument) {
  if (!aDocument || aDocument->GetSpeculumMutationObserver()) {
    return;
  }
  RefPtr<SpeculumMutationObserver> obs = new SpeculumMutationObserver(aDocument);
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
