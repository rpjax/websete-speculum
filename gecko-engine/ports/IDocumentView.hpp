#pragma once

#include <string_view>

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

class IDocumentView {
 public:
  virtual ~IDocumentView() = default;

  virtual NodeRef root() const = 0;
  virtual NodeKind kind(NodeRef) const = 0;
  virtual ElementNs ns(NodeRef) const = 0;
  virtual std::string_view localName(NodeRef) const = 0;
  virtual std::string_view characterData(NodeRef) const = 0;
  virtual uint32_t childCount(NodeRef) const = 0;
  virtual NodeRef childAt(NodeRef, uint32_t) const = 0;
  virtual NodeRef parent(NodeRef) const = 0;
  virtual NodeRef shadowRoot(NodeRef) const = 0;
  virtual NodeRef shadowHost(NodeRef) const = 0;
  virtual uint32_t attrCount(NodeRef) const = 0;
  virtual void attrAt(NodeRef, uint32_t, std::string_view& name,
                      std::string_view& value) const = 0;
  virtual bool attr(NodeRef, std::string_view name,
                    std::string_view& value) const = 0;
  virtual uint32_t sheetCount() const = 0;
  virtual SheetRef sheetAt(uint32_t) const = 0;
  virtual bool sheetDisabled(SheetRef) const = 0;
  virtual std::string_view sheetMedia(SheetRef) const = 0;
  virtual NodeRef sheetOwner(SheetRef) const = 0;
  virtual uint32_t ruleCount(SheetRef) const = 0;
  virtual RuleRef ruleAt(SheetRef, uint32_t) const = 0;
  virtual RuleRef parentRule(RuleRef) const = 0;
  virtual std::string_view ruleType(RuleRef) const = 0;
  virtual std::string_view ruleCondition(RuleRef) const = 0;
  virtual std::string_view ruleSelector(RuleRef) const = 0;
  virtual uint32_t declarationCount(RuleRef) const = 0;
  virtual void declarationAt(RuleRef, uint32_t, std::string_view& name,
                             AtomRef& value, bool& important) const = 0;
};

}  // namespace speculum
