/* Speculum — NodeSource sobre nsINode (produtor PageProjection). */
#ifndef dom_base_SpeculumNodeSource_h
#define dom_base_SpeculumNodeSource_h

#include "mozilla/Assertions.h"

void SpeculumProducerAbort(const char* aMsg);
#ifndef SPECULUM_FATAL
#  define SPECULUM_FATAL(msg) SpeculumProducerAbort(msg)
#endif
#include "speculum/Producer.h"

#include "mozilla/RefPtr.h"
#include "mozilla/StyleSheet.h"
#include "mozilla/css/Rule.h"
#include "nsINode.h"

#include <map>
#include <string>
#include <vector>

namespace mozilla::dom {
class Document;
}

void SpeculumTryWriteBootstrapFrame(mozilla::dom::Document* aDocument);

class SpeculumNodeSource final : public speculum::NodeSource {
 public:
  SpeculumNodeSource();

  speculum::NodeKind kindOf(const void* node) const override;
  speculum::ElementNs nsOf(const void* node) const override;
  std::string uriOf(const void* node) const override;
  std::string nameOf(const void* node) const override;
  std::string valueOf(const void* node) const override;
  std::vector<speculum::AttrPair> attrsOf(const void* node) const override;
  std::vector<const void*> childrenOf(const void* node) const override;
  bool isUaOwned(const void* node) const override;
  bool isNestedHost(const void* node) const override;
  uint32_t childScopeIdOf(const void* node) const override;
  bool isConnected(const void* node) const override;

  bool isSheet(const void* aPtr) const override;
  bool isRule(const void* aPtr) const override;
  void retainPtr(const void* aPtr, speculum::KeySpace aSpace) override;
  void releasePtr(const void* aPtr, speculum::KeySpace aSpace) override;

  const void* shadowRootOf(const void* host) const override;
  const void* shadowHostOf(const void* shadowRoot) const override;
  uint8_t shadowModeOf(const void* shadowRoot) const override;
  uint8_t shadowInitFlagsOf(const void* shadowRoot) const override;
  std::vector<speculum::FormProp> formPropsOf(const void* node) const override;

  void BindDocument(mozilla::dom::Document* aDocument);
  void CaptureLiveCssom();
  void NoteSheet(const void* aSheet);
  void DropSheet(const void* aSheet);
  bool NoteRule(const void* aSheet, const void* aRule, const std::string& aText);
  void DropRule(const void* aRule);
  void SetRuleText(const void* aRule, const std::string& aText);

  std::vector<const void*> cssomSheets() const override;
  std::vector<const void*> cssomRulesOf(const void* sheet) const override;
  std::vector<const void*> cssomChildSheets(const void* sheet) const override;
  std::string cssomRuleTextOf(const void* rule) const override;
  const void* cssomSheetOf(const void* rule) const override;
  const void* cssomHostOf(const void* sheet) const override;

 private:
  bool IsCssom(const void* aPtr) const { return isSheet(aPtr) || isRule(aPtr); }

  mozilla::dom::Document* mDocument = nullptr;
  std::vector<const void*> mSheets;
  std::map<const void*, std::vector<const void*>> mRules;
  std::map<const void*, std::string> mRuleText;
  std::map<const void*, const void*> mRuleSheet;
  std::map<const void*, RefPtr<nsINode>> mHeldNodes;
  std::map<const void*, RefPtr<mozilla::StyleSheet>> mHeldSheets;
  std::map<const void*, RefPtr<mozilla::css::Rule>> mHeldRules;
};

#endif
