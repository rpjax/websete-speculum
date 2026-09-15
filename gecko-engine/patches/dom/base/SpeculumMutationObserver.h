/* Speculum — minimal DOM mutation probe (producer spike). */
#ifndef dom_base_SpeculumMutationObserver_h
#define dom_base_SpeculumMutationObserver_h

#include "mozilla/UniquePtr.h"
#include "nsStubMutationObserver.h"
#include "nsITimer.h"

#include <cstdint>
#include <string>
#include <vector>

struct SpeculumProducerState;
class nsINode;

namespace mozilla::dom {
class Document;
}

class SpeculumMutationObserver final : public nsStubMutationObserver,
                                       public nsITimerCallback {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSITIMERCALLBACK

  SpeculumMutationObserver(mozilla::dom::Document* aDocument, uint32_t aContextId);

  bool TryWriteBootstrapFrame();
  void RequestResync(uint8_t aForce);
  void SetHalted(bool aHalted);
  void FlushNow();
  bool SnapshotDump(std::vector<uint8_t>& aOut) const;
  uint32_t ContextId() const;
  uint32_t Sequence() const;
  uint32_t Generation() const;
  uint64_t TableHash() const;

  void OnSheetAdded(void* aSheet);
  void OnSheetRemoved(void* aSheet);
  void OnRuleAdded(void* aSheet, void* aRule, const std::string& aText);
  void OnRuleRemoved(void* aSheet, void* aRule);
  void OnRuleChanged(void* aRule, const std::string& aText);

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

  mozilla::dom::Document* GetDocument() const { return mDocument; }
  const void* IdentityKey(uint32_t aNodeId) const;

 private:
  ~SpeculumMutationObserver();

  void ArmFrameTimerIfNeeded();
  void EmitPendingFrame();
  void MaybeObserveShadow(nsIContent* aChild);

  mozilla::dom::Document* mDocument;
  mozilla::UniquePtr<SpeculumProducerState> mState;
};

void SpeculumAttachMutationObserverToDocument(mozilla::dom::Document* aDocument);
void SpeculumDetachMutationObserverFromDocument(mozilla::dom::Document* aDocument);
void SpeculumBindLiveDocument(mozilla::dom::Document* aDocument);
void SpeculumRequestResync(uint32_t aContextId, uint8_t aForce);
void SpeculumHaltClocks();
void SpeculumResumeClocks();
void SpeculumFlushFrame(uint32_t aContextId);
bool SpeculumSnapshotDump(uint32_t aContextId, std::vector<uint8_t>& aOut,
                          uint32_t* aSequence, uint32_t* aGeneration,
                          uint64_t* aTableHash);
mozilla::dom::Document* SpeculumDocumentForContext(uint32_t aContextId);
nsINode* SpeculumNodeForId(uint32_t aContextId, uint32_t aNodeId);

#endif
