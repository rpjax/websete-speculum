/* Speculum — Document::Rule* / InsertSheet* vira onSheet/onRule no Producer. */
#include "SpeculumCssom.h"

#include "SpeculumMutationObserver.h"
#include "mozilla/css/Rule.h"
#include "mozilla/dom/Document.h"
#include "nsString.h"

#include <string>

static SpeculumMutationObserver* ObserverOf(mozilla::dom::Document* aDocument) {
  return aDocument ? aDocument->GetSpeculumMutationObserver() : nullptr;
}

static std::string CssTextOf(mozilla::css::Rule& aRule) {
  nsAutoCString text;
  aRule.GetCssText(text);
  return std::string(text.get());
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
    obs->OnRuleAdded(aSheet, &aRule, CssTextOf(aRule));
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
  if (!aRule) {
    return;
  }
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnRuleChanged(aRule, CssTextOf(*aRule));
  }
}
