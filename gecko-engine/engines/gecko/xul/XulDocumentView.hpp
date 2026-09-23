#pragma once

#if defined(SPECULUM_HAS_LIBXUL)

#include <string>
#include <string_view>

#include "mozilla/dom/Document.h"
#include "nsINode.h"

#include "domain/Types.hpp"
#include "engines/gecko/CssomTable.hpp"
#include "engines/gecko/RawNodeMap.hpp"
#include "ports/IDocumentView.hpp"

namespace speculum::gecko::xul {

// IDocumentView over live nsINode* (raw map). Sheets/rules via process CssomTable.
class XulDocumentView final : public IDocumentView {
 public:
  XulDocumentView(RawNodeMap& nodes, CssomTable* cssom)
      : nodes_(nodes), cssom_(cssom) {}

  void bindDocument(mozilla::dom::Document* doc) {
    doc_ = doc;
    if (doc_) {
      root_ = nodes_.intern(static_cast<void*>(doc_));
    } else {
      root_ = {};
    }
  }

  mozilla::dom::Document* document() const { return doc_; }
  RawNodeMap& nodes() { return nodes_; }

  NodeRef root() const override { return root_; }

  NodeKind kind(NodeRef r) const override;
  ElementNs ns(NodeRef r) const override;
  std::string_view localName(NodeRef r) const override;
  std::string_view characterData(NodeRef r) const override;
  uint32_t childCount(NodeRef r) const override;
  NodeRef childAt(NodeRef r, uint32_t i) const override;
  NodeRef parent(NodeRef r) const override;
  NodeRef shadowRoot(NodeRef host) const override;
  NodeRef shadowHost(NodeRef) const override;
  uint32_t attrCount(NodeRef r) const override;
  void attrAt(NodeRef r, uint32_t i, std::string_view& name,
              std::string_view& value) const override;
  bool attr(NodeRef r, std::string_view name, std::string_view& value) const override;
  uint32_t sheetCount() const override;
  SheetRef sheetAt(uint32_t i) const override;
  bool sheetDisabled(SheetRef) const override;
  std::string_view sheetMedia(SheetRef) const override;
  NodeRef sheetOwner(SheetRef s) const override;
  uint32_t ruleCount(SheetRef s) const override;
  RuleRef ruleAt(SheetRef s, uint32_t i) const override;
  RuleRef parentRule(RuleRef) const override;
  std::string_view ruleType(RuleRef) const override;
  std::string_view ruleCondition(RuleRef) const override;
  std::string_view ruleSelector(RuleRef) const override;
  uint32_t declarationCount(RuleRef) const override;
  void declarationAt(RuleRef, uint32_t, std::string_view& name, AtomRef& value,
                     bool& important) const override;

 private:
  nsINode* raw(NodeRef r) const {
    return static_cast<nsINode*>(nodes_.resolve(r));
  }

  RawNodeMap& nodes_;
  CssomTable* cssom_{nullptr};
  mozilla::dom::Document* doc_{nullptr};  // weak
  NodeRef root_{};
  // Scratch for string_view returns (single-threaded main).
  mutable std::string scratchName_;
  mutable std::string scratchValue_;
};

}  // namespace speculum::gecko::xul

#endif  // SPECULUM_HAS_LIBXUL
