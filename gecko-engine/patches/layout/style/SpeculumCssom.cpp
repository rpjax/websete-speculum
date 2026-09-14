/* Speculum — RuleAdded* vira onRule* no Producer. */
#include "SpeculumCssom.h"

#include "SpeculumMutationObserver.h"
#include "mozilla/dom/Document.h"

static SpeculumMutationObserver* ObserverOf(mozilla::dom::Document* aDocument) {
  return aDocument ? aDocument->GetSpeculumMutationObserver() : nullptr;
}

void SpeculumNotifySheetAdded(mozilla::dom::Document* aDocument,
                              mozilla::StyleSheet* aSheet) {
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnSheetAdded(aSheet);
  }
}

void SpeculumNotifySheetRemoved(mozilla::dom::Document* aDocument,
                                mozilla::StyleSheet* aSheet) {
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnSheetRemoved(aSheet);
  }
}

void SpeculumNotifyRuleAdded(mozilla::dom::Document* aDocument,
                             mozilla::StyleSheet* aSheet,
                             mozilla::css::Rule& aRule) {
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnRuleAdded(aSheet, &aRule);
  }
}

void SpeculumNotifyRuleRemoved(mozilla::dom::Document* aDocument,
                               mozilla::StyleSheet* aSheet,
                               mozilla::css::Rule& aRule) {
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnRuleRemoved(aSheet, &aRule);
  }
}

void SpeculumNotifyRuleChanged(mozilla::dom::Document* aDocument,
                               mozilla::css::Rule* aRule) {
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnRuleChanged(aRule);
  }
}
