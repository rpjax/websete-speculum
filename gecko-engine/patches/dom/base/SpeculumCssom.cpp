/* Speculum — Document::Rule* / InsertSheet* vira onSheet/onRule no Producer. */
#include "SpeculumCssom.h"

#include "SpeculumMutationObserver.h"
#include "mozilla/ServoCSSRuleList.h"
#include "mozilla/StyleSheet.h"
#include "mozilla/css/Rule.h"
#include "mozilla/dom/Document.h"
#include "nsGkAtoms.h"
#include "nsINode.h"
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

bool SpeculumIsCssomPlaneSheet(mozilla::StyleSheet* aSheet) {
  if (!aSheet) {
    return false;
  }
  // Constructed / adopted: só existem no plano CSSOM.
  if (aSheet->IsConstructed()) {
    return true;
  }
  nsINode* owner = aSheet->GetOwnerNode();
  if (!owner) {
    return true;
  }
  // Author `<style>`: texto no DOM projetado pinta a sheet. Emitir de novo no
  // adopted = double-paint (H4 dual). `<link>` fica — CSS não é buscado no
  // cliente Gecko (doc 13); regras vão no fio.
  if (owner->IsHTMLElement(nsGkAtoms::style)) {
    return false;
  }
  return true;
}

void SpeculumNotifySheetAdded(mozilla::dom::Document* aDocument,
                              mozilla::StyleSheet* aSheet) {
  if (!SpeculumIsCssomPlaneSheet(aSheet)) {
    return;
  }
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnSheetAdded(aSheet);
  }
}

void SpeculumNotifySheetRemoved(mozilla::dom::Document* aDocument,
                                mozilla::StyleSheet* aSheet) {
  // Remoção: sempre avisa se já estava no mapa (idempotente no Producer).
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnSheetRemoved(aSheet);
  }
}

void SpeculumNotifyRuleAdded(mozilla::dom::Document* aDocument,
                             mozilla::StyleSheet* aSheet,
                             mozilla::css::Rule& aRule) {
  if (!SpeculumIsCssomPlaneSheet(aSheet)) {
    return;
  }
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnRuleAdded(aSheet, &aRule, CssTextOf(aRule));
  }
}

void SpeculumNotifyRuleRemoved(mozilla::dom::Document* aDocument,
                               mozilla::StyleSheet* aSheet,
                               mozilla::css::Rule& aRule) {
  if (!SpeculumIsCssomPlaneSheet(aSheet)) {
    return;
  }
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnRuleRemoved(aSheet, &aRule);
  }
}

void SpeculumNotifySheetApplicable(mozilla::dom::Document* aDocument,
                                   mozilla::StyleSheet* aSheet) {
  if (!aSheet || !aSheet->IsApplicable()) {
    return;
  }
  SpeculumMutationObserver* obs = ObserverOf(aDocument);
  if (!obs) {
    return;
  }
  auto emit = [&](auto&& self, mozilla::StyleSheet* sheet) -> void {
    if (!SpeculumIsCssomPlaneSheet(sheet)) {
      return;
    }
    obs->OnSheetAdded(sheet);
    mozilla::ServoCSSRuleList* list = sheet->GetCssRulesInternal();
    if (list) {
      const uint32_t n = list->Length();
      for (uint32_t i = 0; i < n; ++i) {
        if (mozilla::css::Rule* rule = list->Item(i)) {
          obs->OnRuleAdded(sheet, rule, CssTextOf(*rule));
        }
      }
    }
    for (mozilla::StyleSheet* child : sheet->ChildSheets()) {
      if (child) {
        self(self, child);
      }
    }
  };
  emit(emit, aSheet);
}

void SpeculumNotifyRuleChanged(mozilla::dom::Document* aDocument,
                               mozilla::css::Rule* aRule) {
  if (!aRule) {
    return;
  }
  if (!SpeculumIsCssomPlaneSheet(aRule->GetStyleSheet())) {
    return;
  }
  if (SpeculumMutationObserver* obs = ObserverOf(aDocument)) {
    obs->OnRuleChanged(aRule, CssTextOf(*aRule));
  }
}
