/* Speculum — minimal DOM mutation probe (producer spike). */
#include "SpeculumMutationObserver.h"

#include "mozilla/ClearOnShutdown.h"
#include "mozilla/StaticPtr.h"
#include "mozilla/dom/Document.h"
#include "nsDebug.h"

using mozilla::StaticRefPtr;

NS_IMPL_ISUPPORTS(SpeculumMutationObserver, nsIMutationObserver)

#define SPECULUM_LOG(cb) printf_stderr("[SPECULUM] %s\n", cb)

void SpeculumMutationObserver::CharacterDataWillChange(
    nsIContent*, const CharacterDataChangeInfo&) {
  SPECULUM_LOG("CharacterDataWillChange");
}

void SpeculumMutationObserver::CharacterDataChanged(
    nsIContent*, const CharacterDataChangeInfo&) {
  SPECULUM_LOG("CharacterDataChanged");
}

void SpeculumMutationObserver::AttributeWillChange(mozilla::dom::Element*,
                                                   int32_t, nsAtom*,
                                                   AttrModType) {
  SPECULUM_LOG("AttributeWillChange");
}

void SpeculumMutationObserver::AttributeChanged(mozilla::dom::Element*, int32_t,
                                                nsAtom*, AttrModType,
                                                const nsAttrValue*) {
  SPECULUM_LOG("AttributeChanged");
}

void SpeculumMutationObserver::AttributeSetToCurrentValue(
    mozilla::dom::Element*, int32_t, nsAtom*) {
  SPECULUM_LOG("AttributeSetToCurrentValue");
}

void SpeculumMutationObserver::ContentAppended(nsIContent*,
                                               const ContentAppendInfo&) {
  SPECULUM_LOG("ContentAppended");
}

void SpeculumMutationObserver::ContentInserted(nsIContent*,
                                               const ContentInsertInfo&) {
  SPECULUM_LOG("ContentInserted");
}

void SpeculumMutationObserver::ContentWillBeRemoved(nsIContent*,
                                                    const ContentRemoveInfo&) {
  SPECULUM_LOG("ContentWillBeRemoved");
}

void SpeculumMutationObserver::NodeWillBeDestroyed(nsINode*) {
  SPECULUM_LOG("NodeWillBeDestroyed");
}

void SpeculumMutationObserver::ParentChainChanged(nsIContent*) {
  SPECULUM_LOG("ParentChainChanged");
}

static StaticRefPtr<SpeculumMutationObserver> sSpeculumMutationObserver;

void SpeculumAttachMutationObserverToDocument(Document* aDocument) {
  if (!aDocument) {
    return;
  }
  if (MOZ_UNLIKELY(!sSpeculumMutationObserver)) {
    sSpeculumMutationObserver = new SpeculumMutationObserver();
    ClearOnShutdown(&sSpeculumMutationObserver);
  }
  aDocument->AddMutationObserver(sSpeculumMutationObserver);
}

void SpeculumDetachMutationObserverFromDocument(Document* aDocument) {
  if (!aDocument || !sSpeculumMutationObserver) {
    return;
  }
  aDocument->RemoveMutationObserver(sSpeculumMutationObserver);
}
