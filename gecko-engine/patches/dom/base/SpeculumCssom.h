/* Speculum — ganchos CSSOM. Chamados de StyleSheet::RuleAdded/Removed/Changed
 * (02-costura §4). Sem poll. Sem símbolo inventado. */
#ifndef DOM_BASE_SPECULUMCSSOM_H_
#define DOM_BASE_SPECULUMCSSOM_H_

namespace mozilla {
namespace css {
class Rule;
}
class StyleSheet;
}  // namespace mozilla

namespace mozilla::dom {
class Document;
}

void SpeculumNotifySheetAdded(mozilla::dom::Document* aDocument,
                              mozilla::StyleSheet* aSheet);
void SpeculumNotifySheetRemoved(mozilla::dom::Document* aDocument,
                                mozilla::StyleSheet* aSheet);
void SpeculumNotifyRuleAdded(mozilla::dom::Document* aDocument,
                             mozilla::StyleSheet* aSheet,
                             mozilla::css::Rule& aRule);
void SpeculumNotifyRuleRemoved(mozilla::dom::Document* aDocument,
                               mozilla::StyleSheet* aSheet,
                               mozilla::css::Rule& aRule);
void SpeculumNotifyRuleChanged(mozilla::dom::Document* aDocument,
                               mozilla::css::Rule* aRule);

#endif
