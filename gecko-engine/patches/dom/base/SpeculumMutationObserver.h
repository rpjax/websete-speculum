/* Speculum — minimal DOM mutation probe (producer spike). */
#ifndef dom_base_SpeculumMutationObserver_h
#define dom_base_SpeculumMutationObserver_h

#include "SpeculumNodeSource.h"
#include "mozilla/RefPtr.h"
#include "nsStubMutationObserver.h"
#include "nsITimer.h"
#include "speculum/Producer.h"

namespace mozilla::dom {
class Document;
}

class SpeculumMutationObserver final : public nsStubMutationObserver,
                                       public nsITimerCallback {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSITIMERCALLBACK

  explicit SpeculumMutationObserver(mozilla::dom::Document* aDocument);

  bool TryWriteBootstrapFrame();

  void CancelFrameTimer();

  void CharacterDataWillChange(nsIContent* aContent,
                               const CharacterDataChangeInfo&) override;
  void CharacterDataChanged(nsIContent* aContent,
                            const CharacterDataChangeInfo&) override;
  void AttributeWillChange(mozilla::dom::Element* aElement, int32_t aNamespaceID,
                           nsAtom* aAttribute, AttrModType aModType) override;
  void AttributeChanged(mozilla::dom::Element* aElement, int32_t aNamespaceID,
                        nsAtom* aAttribute, AttrModType aModType,
                        const nsAttrValue* aOldValue) override;
  void AttributeSetToCurrentValue(mozilla::dom::Element* aElement,
                                  int32_t aNamespaceID,
                                  nsAtom* aAttribute) override;
  void ContentAppended(nsIContent* aFirstNewContent,
                       const ContentAppendInfo&) override;
  void ContentInserted(nsIContent* aChild,
                       const ContentInsertInfo&) override;
  void ContentWillBeRemoved(nsIContent* aChild,
                            const ContentRemoveInfo&) override;
  void NodeWillBeDestroyed(nsINode* aNode) override;
  void ParentChainChanged(nsIContent* aContent) override;

 private:
  ~SpeculumMutationObserver() override;

  void ArmFrameTimerIfNeeded();
  void EmitPendingFrame();
  void SendFrameBytes(const std::vector<uint8_t>& aFrame, uint32_t aOps,
                      bool aBootstrap);

  mozilla::dom::Document* mDocument;
  SpeculumNodeSource mSource;
  speculum::Producer mProducer;
  nsCOMPtr<nsITimer> mFrameTimer;
};

void SpeculumAttachMutationObserverToDocument(mozilla::dom::Document* aDocument);
void SpeculumDetachMutationObserverFromDocument(mozilla::dom::Document* aDocument);

#endif
