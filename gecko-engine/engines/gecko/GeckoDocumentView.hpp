#pragma once

#include <algorithm>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"
#include "engines/gecko/RawNodeMap.hpp"
#include "ports/IDocumentView.hpp"

namespace speculum::gecko {

struct NativeNode {
  NodeKind kind{NodeKind::Element};
  ElementNs ns{ElementNs::Html};
  std::string localName;
  std::string data;
  NativeNode* parent{nullptr};
  std::vector<NativeNode*> children;
  std::vector<std::pair<std::string, std::string>> attrs;
  std::vector<NativeNode*> shadowChildren;  // nested shadow roots under this host
  bool isShadowRoot{false};
};

// Host-compileable document view. Production replaces NativeNode* with nsINode* via Xul glue.
// Invariant: RawNodeMap holds ONLY raw pointers — never RefPtr of node.
class GeckoDocumentView final : public IDocumentView {
 public:
  NodeRef ensureRoot() {
    if (root_ref_.valid()) return root_ref_;
    auto* n = new NativeNode();
    n->kind = NodeKind::Document;
    n->localName = "html";
    root_ref_ = map_.intern(n);
    owned_.push_back(std::unique_ptr<NativeNode>(n));
    return root_ref_;
  }

  RawNodeMap& nodes() { return map_; }
  const RawNodeMap& nodes() const { return map_; }

  NativeNode* native(NodeRef r) { return static_cast<NativeNode*>(map_.resolve(r)); }
  const NativeNode* native(NodeRef r) const {
    return static_cast<const NativeNode*>(map_.resolve(r));
  }

  NodeRef mint(NodeKind kind, std::string_view name) {
    auto* n = new NativeNode();
    n->kind = kind;
    n->localName = std::string(name);
    NodeRef id = map_.intern(n);
    owned_.push_back(std::unique_ptr<NativeNode>(n));
    return id;
  }

  void appendChild(NodeRef parent, NodeRef child) {
    auto* p = native(parent);
    auto* c = native(child);
    if (!p || !c) return;
    c->parent = p;
    p->children.push_back(c);
  }

  void insertChild(NodeRef parent, NodeRef child, uint32_t index) {
    auto* p = native(parent);
    auto* c = native(child);
    if (!p || !c) return;
    c->parent = p;
    if (index > p->children.size()) index = uint32_t(p->children.size());
    p->children.insert(p->children.begin() + index, c);
  }

  bool removeChild(NodeRef parent, NodeRef child) {
    auto* p = native(parent);
    auto* c = native(child);
    if (!p || !c) return false;
    auto it = std::find(p->children.begin(), p->children.end(), c);
    if (it == p->children.end()) return false;
    p->children.erase(it);
    c->parent = nullptr;
    return true;
  }

  int32_t indexOfChild(NodeRef parent, NodeRef child) const {
    const auto* p = native(parent);
    const auto* c = native(child);
    if (!p || !c) return -1;
    for (size_t i = 0; i < p->children.size(); ++i)
      if (p->children[i] == c) return int32_t(i);
    return -1;
  }

  void setAttr(NodeRef el, std::string_view name, std::string_view value) {
    auto* n = native(el);
    if (!n) return;
    for (auto& a : n->attrs) {
      if (a.first == name) {
        a.second = std::string(value);
        return;
      }
    }
    n->attrs.emplace_back(name, value);
  }

  void setText(NodeRef r, std::string_view data) {
    auto* n = native(r);
    if (!n) return;
    n->data = std::string(data);
  }

  // Attach shadow root under host; returns shadow NodeRef. Recursive observation is caller's job.
  NodeRef attachShadow(NodeRef host) {
    auto* h = native(host);
    if (!h) return {};
    auto* s = new NativeNode();
    s->kind = NodeKind::Document;
    s->localName = "#shadow";
    s->isShadowRoot = true;
    s->parent = h;
    h->shadowChildren.push_back(s);
    NodeRef id = map_.intern(s);
    owned_.push_back(std::unique_ptr<NativeNode>(s));
    return id;
  }

  std::vector<NodeRef> shadowRootsOf(NodeRef host) const {
    std::vector<NodeRef> out;
    const auto* h = native(host);
    if (!h) return out;
    for (auto* s : h->shadowChildren) {
      auto id = map_.lookup(s);
      if (id.valid()) out.push_back(id);
    }
    return out;
  }

  // Destroy all natives — clears RawNodeMap (leak test expects empty after).
  void teardown() {
    map_.clear();
    owned_.clear();
    root_ref_ = {};
    sheets_.clear();
    sheet_order_.clear();
  }

  SheetRef mintSheet(NodeRef owner) {
    SheetRef id{++sheet_seq_};
    sheets_[id.value()] = owner;
    sheet_order_.push_back(id);
    return id;
  }

  // Register an externally minted sheet id (from process CssomTable).
  void noteSheet(SheetRef id, NodeRef owner) {
    sheets_[id.value()] = owner;
    sheet_order_.push_back(id);
    if (id.value() > sheet_seq_) sheet_seq_ = id.value();
  }

  NodeRef root() const override { return root_ref_; }
  NodeKind kind(NodeRef r) const override {
    const auto* n = native(r);
    return n ? n->kind : NodeKind::Element;
  }
  ElementNs ns(NodeRef r) const override {
    const auto* n = native(r);
    return n ? n->ns : ElementNs::Html;
  }
  std::string_view localName(NodeRef r) const override {
    const auto* n = native(r);
    return n ? std::string_view(n->localName) : std::string_view{};
  }
  std::string_view characterData(NodeRef r) const override {
    const auto* n = native(r);
    return n ? std::string_view(n->data) : std::string_view{};
  }
  uint32_t childCount(NodeRef r) const override {
    const auto* n = native(r);
    return n ? uint32_t(n->children.size()) : 0;
  }
  NodeRef childAt(NodeRef r, uint32_t i) const override {
    const auto* n = native(r);
    if (!n || i >= n->children.size()) return {};
    return map_.lookup(n->children[i]);
  }
  NodeRef parent(NodeRef r) const override {
    const auto* n = native(r);
    return n && n->parent ? map_.lookup(n->parent) : NodeRef{};
  }
  NodeRef shadowRoot(NodeRef host) const override {
    auto v = shadowRootsOf(host);
    return v.empty() ? NodeRef{} : v.front();
  }
  NodeRef shadowHost(NodeRef) const override { return {}; }
  uint32_t attrCount(NodeRef r) const override {
    const auto* n = native(r);
    return n ? uint32_t(n->attrs.size()) : 0;
  }
  void attrAt(NodeRef r, uint32_t i, std::string_view& name,
              std::string_view& value) const override {
    const auto* n = native(r);
    if (!n || i >= n->attrs.size()) {
      name = {};
      value = {};
      return;
    }
    name = n->attrs[i].first;
    value = n->attrs[i].second;
  }
  bool attr(NodeRef r, std::string_view name, std::string_view& value) const override {
    const auto* n = native(r);
    if (!n) return false;
    for (const auto& a : n->attrs) {
      if (a.first == name) {
        value = a.second;
        return true;
      }
    }
    return false;
  }
  uint32_t sheetCount() const override { return uint32_t(sheet_order_.size()); }
  SheetRef sheetAt(uint32_t i) const override {
    return i < sheet_order_.size() ? sheet_order_[i] : SheetRef{};
  }
  bool sheetDisabled(SheetRef) const override { return false; }
  std::string_view sheetMedia(SheetRef) const override { return {}; }
  NodeRef sheetOwner(SheetRef s) const override {
    auto it = sheets_.find(s.value());
    return it == sheets_.end() ? NodeRef{} : it->second;
  }
  uint32_t ruleCount(SheetRef) const override { return 0; }
  RuleRef ruleAt(SheetRef, uint32_t) const override { return {}; }
  RuleRef parentRule(RuleRef) const override { return {}; }
  std::string_view ruleType(RuleRef) const override { return {}; }
  std::string_view ruleCondition(RuleRef) const override { return {}; }
  std::string_view ruleSelector(RuleRef) const override { return {}; }
  uint32_t declarationCount(RuleRef) const override { return 0; }
  void declarationAt(RuleRef, uint32_t, std::string_view& name, AtomRef& value,
                     bool& important) const override {
    name = {};
    value = {};
    important = false;
  }

 private:
  RawNodeMap map_;
  std::vector<std::unique_ptr<NativeNode>> owned_;
  NodeRef root_ref_{};
  uint32_t sheet_seq_{0};
  std::unordered_map<uint32_t, NodeRef> sheets_;
  std::vector<SheetRef> sheet_order_;
};

}  // namespace speculum::gecko
