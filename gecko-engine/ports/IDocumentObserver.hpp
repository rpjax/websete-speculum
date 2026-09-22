#pragma once

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

class IDocumentObserver {
 public:
  virtual ~IDocumentObserver() = default;

  virtual void onReady() = 0;
  virtual void onRoot(NodeRef root) = 0;
  virtual void onChildList(NodeRef parent, uint32_t index, uint32_t remove,
                           const NodeRef* add, uint32_t addCount) = 0;
  virtual void onCharacterData(NodeRef node, std::string_view data) = 0;
  virtual void onAttr(NodeRef el, std::string_view name, std::string_view value) = 0;
  virtual void onAttrRemoved(NodeRef el, std::string_view name) = 0;
  virtual void onShadow(NodeRef host, ShadowMode mode, NodeRef root) = 0;
  virtual void onCustomElement(NodeRef el, std::string_view name) = 0;
  virtual void onSheetAdded(SheetRef sheet, uint32_t index) = 0;
  virtual void onSheetRemoved(SheetRef sheet) = 0;
  virtual void onSheetDisabled(SheetRef sheet, bool disabled) = 0;
  virtual void onSheetMedia(SheetRef sheet, std::string_view media) = 0;
  virtual void onSheetOwner(SheetRef sheet, NodeRef owner) = 0;
  virtual void onRuleInserted(SheetRef sheet, RuleRef rule, uint32_t index) = 0;
  virtual void onRuleDeleted(SheetRef sheet, uint32_t index) = 0;
  virtual void onRuleReplaced(SheetRef sheet, uint32_t index, RuleRef rule) = 0;
  virtual void onRuleCondition(RuleRef rule, std::string_view text) = 0;
  virtual void onRuleSelector(RuleRef rule, std::string_view text) = 0;
  virtual void onDeclaration(RuleRef rule, std::string_view name,
                             AtomRef value, bool important) = 0;
  virtual void onDeclarationRemoved(RuleRef rule, std::string_view name) = 0;
  virtual void onScroll(NodeRef el, float x, float y) = 0;
  virtual void onFormControl(NodeRef el, std::string_view name,
                             std::string_view value) = 0;
  virtual void onMedia(NodeRef el, /* MediaState */ int state) = 0;
  virtual void onLoad(NodeRef el, bool ok) = 0;
  virtual void onPrompt(RequestId id, PromptKind kind,
                        std::string_view detail) = 0;
};

}  // namespace speculum
