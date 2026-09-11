/* Speculum — minimal DOM mutation probe (producer spike). */
#ifndef dom_base_SpeculumMutationObserver_h
#define dom_base_SpeculumMutationObserver_h

#include "nsStubMutationObserver.h"

class SpeculumMutationObserver final : public nsStubMutationObserver {
 public:
  NS_DECL_ISUPPORTS

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
  ~SpeculumMutationObserver() = default;
};

namespace mozilla::dom {
class Document;
}

void SpeculumAttachMutationObserverToDocument(mozilla::dom::Document* aDocument);
void SpeculumDetachMutationObserverFromDocument(mozilla::dom::Document* aDocument);

#endif
