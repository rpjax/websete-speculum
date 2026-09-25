#pragma once

#include <string>

#include "domain/producer/Identity.hpp"
#include "domain/producer/NodeDescriptor.hpp"
#include "domain/producer/RowHash.hpp"
#include "domain/producer/SiblingScan.hpp"
#include "ports/IDocumentView.hpp"

namespace speculum::producer {

class LiveDescriptor final : public NodeDescriptor {
 public:
  LiveDescriptor(const IDocumentView& view, Identity& identity, NodeRef handle,
                 SiblingScanMeter* scan = nullptr)
      : view_(view), identity_(identity), handle_(handle), scan_(scan) {
    id_ = identity_.lookup(handle_.value(), KeySpace::Node);
    if (!id_ && handle_.valid()) id_ = identity_.assign(handle_.value(), KeySpace::Node);
  }

  // When the caller already knows prev (sibling run / table row), skip the O(n) child walk.
  void setPrevSiblingHint(NodeId id) {
    prev_hint_ = id;
    has_prev_hint_ = true;
  }

  NodeId id() const override { return id_; }
  NodeKind kind() const override { return view_.kind(handle_); }
  ElementNs ns() const override { return view_.ns(handle_); }
  std::string_view name() const override { return view_.localName(handle_); }
  FieldHash value() const override { return hashValue(view_.characterData(handle_)); }
  FieldHash attr(std::string_view name) const override {
    std::string_view v;
    if (!view_.attr(handle_, name, v)) return 0;
    return hashAttr(name, v);
  }
  FieldHash prop(PropId) const override { return 0; }
  NodeId parent() const override {
    auto p = view_.parent(handle_);
    return p.valid() ? identity_.lookup(p.value(), KeySpace::Node) : 0;
  }
  NodeId prevSibling() const override {
    if (has_prev_hint_) return prev_hint_;
    auto p = view_.parent(handle_);
    if (!p.valid()) return 0;
    uint32_t n = view_.childCount(p);
    NodeRef prev{};
    uint32_t examined = 0;
    for (uint32_t i = 0; i < n; ++i) {
      ++examined;
      auto c = view_.childAt(p, i);
      if (c == handle_) {
        if (scan_) scan_->note(SiblingScanPath::LivePrevSibling, examined);
        return prev.valid() ? identity_.lookup(prev.value(), KeySpace::Node) : 0;
      }
      prev = c;
    }
    if (scan_ && examined) scan_->note(SiblingScanPath::LivePrevSibling, examined);
    return 0;
  }
  FieldHash contentHash() const override {
    FieldHash ch = 0;
    ch = addMod64(ch, hashNs(static_cast<uint8_t>(ns())));
    ch = addMod64(ch, hashName(name()));
    ch = addMod64(ch, value());
    uint32_t ac = view_.attrCount(handle_);
    for (uint32_t i = 0; i < ac; ++i) {
      std::string_view an, av;
      view_.attrAt(handle_, i, an, av);
      ch = addMod64(ch, hashAttr(an, av));
    }
    return ch;
  }
  uint64_t hash() const override {
    return computeRowHash(id_, static_cast<uint32_t>(kind()), parent(), prevSibling(),
                          contentHash());
  }

  NodeRef handle() const { return handle_; }

 private:
  const IDocumentView& view_;
  Identity& identity_;
  NodeRef handle_;
  NodeId id_{0};
  NodeId prev_hint_{0};
  bool has_prev_hint_{false};
  SiblingScanMeter* scan_{nullptr};
};

}  // namespace speculum::producer
