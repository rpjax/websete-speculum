#pragma once

// XUL-only types. Compiled only with SPECULUM_HAS_LIBXUL (moz/w7s build).
// Host MSVC builds never include this header.

#include "nsStubMutationObserver.h"
#include "nsINode.h"

#include "engines/gecko/MutationBridge.hpp"
#include "engines/gecko/RawNodeMap.hpp"

namespace mozilla::dom {
class Document;
class Element;
class ShadowRoot;
}  // namespace mozilla::dom

namespace speculum::gecko::xul {

// Forwards Gecko mutation callbacks → MutationBridge + RawNodeMap.
// No policy, no script, no Producer decisions.
class XulMutationObserver final : public nsStubMutationObserver {
 public:
  NS_DECL_ISUPPORTS

  XulMutationObserver(mozilla::dom::Document* doc, RawNodeMap& nodes,
                      MutationBridge& bridge);

  void AttachToDocument();
  void DetachFromDocument();
  void ObserveShadowRecursive(mozilla::dom::ShadowRoot* shadow);

  void CharacterDataChanged(nsIContent* content,
                            const CharacterDataChangeInfo&) override;
  void AttributeChanged(mozilla::dom::Element* element, int32_t namespaceID,
                        nsAtom* attribute, AttrModType modType,
                        const nsAttrValue* oldValue) override;
  void ContentAppended(nsIContent* firstNewContent,
                       const ContentAppendInfo&) override;
  void ContentInserted(nsIContent* child, const ContentInsertInfo&) override;
  void ContentWillBeRemoved(nsIContent* child,
                            const ContentRemoveInfo&) override;
  void NodeWillBeDestroyed(nsINode* node) override;

 private:
  ~XulMutationObserver();

  NodeRef ensure(nsINode* n);
  void maybeObserveShadow(nsIContent* child);

  mozilla::dom::Document* doc_{nullptr};  // weak — cleared in NodeWillBeDestroyed
  RawNodeMap& nodes_;
  MutationBridge& bridge_;
};

void AttachObserver(mozilla::dom::Document* doc, RawNodeMap& nodes,
                    MutationBridge& bridge);
void DetachObserver(mozilla::dom::Document* doc);

bool xulGlueLinked();

}  // namespace speculum::gecko::xul
