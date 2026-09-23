#pragma once

#include <string>
#include <vector>

#include "domain/Result.hpp"
#include "domain/Types.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/ids/Ids.hpp"
#include "engines/sim/SimDocumentView.hpp"
#include "ports/IDocumentObserver.hpp"
#include "ports/IEngineDocument.hpp"

namespace speculum::sim {

class SimDocument final : public IEngineDocument {
 public:
  explicit SimDocument(DocumentId id) : id_(id) { view_.ensureRoot(); }

  DocumentId id() const override { return id_; }
  const IDocumentView& view() const override { return view_; }
  SimDocumentView& mutableView() { return view_; }

  void attach(IDocumentObserver* obs) override { observer_ = obs; }
  IDocumentObserver* observer() const { return observer_; }

  Result<void> dispatch(NodeRef, const ResolvedGesture&) override {
    return Result<void>::failure(fault::makeFault(
        fault::FaultCode::InputUnknownKind, "SimDocument", "gesture not in phase 3"));
  }

  Box boxOf(NodeRef) const override { return {}; }

  NodeRef appendElement(NodeRef parent, std::string_view name) {
    auto child = view_.mintNode(NodeKind::Element, name);
    uint32_t idx = view_.childCount(parent);
    view_.appendChild(parent, child);
    if (observer_) observer_->onChildList(parent, idx, 0, &child, 1);
    return child;
  }

  // Insert at index (0 = prepend).
  NodeRef insertElement(NodeRef parent, uint32_t index, std::string_view name) {
    auto child = view_.mintNode(NodeKind::Element, name);
    view_.insertChild(parent, child, index);
    if (observer_) observer_->onChildList(parent, index, 0, &child, 1);
    return child;
  }

  // Notify then remove — producer sees child still in view at index.
  bool removeChild(NodeRef parent, NodeRef child) {
    int32_t idx = view_.indexOfChild(parent, child);
    if (idx < 0) return false;
    if (observer_) observer_->onChildList(parent, uint32_t(idx), 1, nullptr, 0);
    return view_.removeChild(parent, child);
  }

  void setAttr(NodeRef el, std::string_view name, std::string_view value) {
    view_.setAttr(el, name, value);
    if (observer_) observer_->onAttr(el, name, value);
  }

  void setText(NodeRef node, std::string_view data) {
    view_.setText(node, data);
    if (observer_) observer_->onCharacterData(node, data);
  }

  // Linked sheet: add without rules, then applicable — adversary path.
  SheetRef addLinkedSheet(NodeRef ownerLink) {
    auto s = view_.mintSheet(ownerLink);
    uint32_t idx = view_.sheetCount() > 0 ? view_.sheetCount() - 1 : 0;
    if (observer_) {
      observer_->onSheetAdded(s, idx);
      observer_->onSheetOwner(s, ownerLink);
    }
    return s;
  }

  void setSheetApplicable(SheetRef s, bool v) {
    view_.setSheetApplicable(s, v);
    // No onRuleInserted — applicable alone must project the sheet.
    if (observer_ && v) {
      // Re-signal owner so producer can materialize from view.
      observer_->onSheetOwner(s, view_.sheetOwner(s));
    }
  }

  RuleRef addRule(SheetRef sheet, std::string_view selector) {
    auto r = view_.mintRule(sheet, selector);
    uint32_t idx = view_.ruleCount(sheet);
    if (idx > 0) --idx;
    if (observer_) observer_->onRuleInserted(sheet, r, idx);
    return r;
  }

  NodeRef attachShadow(NodeRef host) {
    auto root = view_.attachShadow(host);
    if (observer_ && root.valid()) {
      observer_->onShadow(host, ShadowMode::Open, root);
    }
    return root;
  }

 private:
  DocumentId id_;
  SimDocumentView view_;
  IDocumentObserver* observer_{nullptr};
};

}  // namespace speculum::sim
