#pragma once

#include "domain/Result.hpp"
#include "domain/Types.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/ids/Ids.hpp"
#include "engines/gecko/CssomTable.hpp"
#include "engines/gecko/GeckoDocumentView.hpp"
#include "engines/gecko/MutationBridge.hpp"
#include "ports/IDocumentObserver.hpp"
#include "ports/IEngineDocument.hpp"

namespace speculum::gecko {

class GeckoDocument final : public IEngineDocument {
 public:
  GeckoDocument(DocumentId id, CssomTable* cssom) : id_(id), cssom_(cssom) {
    view_.ensureRoot();
  }

  DocumentId id() const override { return id_; }
  const IDocumentView& view() const override { return view_; }
  GeckoDocumentView& mutableView() { return view_; }
  MutationBridge& bridge() { return bridge_; }
  CssomTable* cssom() { return cssom_; }

  void attach(IDocumentObserver* obs) override {
    bridge_.attach(obs);
  }

  Result<void> dispatch(NodeRef, const ResolvedGesture&) override {
    return Result<void>::failure(fault::makeFault(
        fault::FaultCode::InputUnknownKind, "GeckoDocument", "gesture not in phase 8 host"));
  }

  Box boxOf(NodeRef) const override { return {}; }

  NodeRef appendElement(NodeRef parent, std::string_view name) {
    auto child = view_.mint(NodeKind::Element, name);
    uint32_t idx = view_.childCount(parent);
    view_.appendChild(parent, child);
    bridge_.notifyChildList(parent, idx, 0, &child, 1);
    return child;
  }

  NodeRef insertElement(NodeRef parent, uint32_t index, std::string_view name) {
    auto child = view_.mint(NodeKind::Element, name);
    view_.insertChild(parent, child, index);
    bridge_.notifyChildList(parent, index, 0, &child, 1);
    return child;
  }

  bool removeChild(NodeRef parent, NodeRef child) {
    int32_t idx = view_.indexOfChild(parent, child);
    if (idx < 0) return false;
    bridge_.notifyChildList(parent, uint32_t(idx), 1, nullptr, 0);
    return view_.removeChild(parent, child);
  }

  void setAttr(NodeRef el, std::string_view name, std::string_view value) {
    view_.setAttr(el, name, value);
    bridge_.notifyAttr(el, name, value);
  }

  void setText(NodeRef node, std::string_view data) {
    view_.setText(node, data);
    bridge_.notifyText(node, data);
  }

  SheetRef addLinkedSheet(NodeRef ownerLink) {
    SheetRef s{};
    if (cssom_) {
      s = cssom_->addSheet(ownerLink, /*linked=*/true);
      view_.noteSheet(s, ownerLink);
    } else {
      s = view_.mintSheet(ownerLink);
    }
    uint32_t idx = view_.sheetCount();
    bridge_.notifySheetAdded(s, idx > 0 ? idx - 1 : 0);
    bridge_.notifySheetOwner(s, ownerLink);
    return s;
  }

  void setSheetApplicable(SheetRef s, bool v) {
    if (cssom_) cssom_->setApplicable(s, v);
    if (v) bridge_.notifySheetOwner(s, view_.sheetOwner(s));
  }

  RuleRef addRule(SheetRef sheet, std::string_view selector) {
    RuleRef r{};
    if (cssom_) r = cssom_->addRule(sheet, selector);
    if (r.valid()) bridge_.notifyRuleInserted(sheet, r, 0);
    return r;
  }

  NodeRef attachShadow(NodeRef host) {
    auto root = view_.attachShadow(host);
    bridge_.notifyShadow(host, ShadowMode::Open, root);
    return root;
  }

  void teardown() {
    if (cssom_) cssom_->clearDocument(view_.root());
    view_.teardown();
  }

 private:
  DocumentId id_;
  GeckoDocumentView view_;
  MutationBridge bridge_;
  CssomTable* cssom_{nullptr};  // owned by GeckoProcess — never by this document
};

}  // namespace speculum::gecko
