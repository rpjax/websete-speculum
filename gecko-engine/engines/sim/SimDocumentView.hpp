#pragma once

#include <algorithm>
#include <cstdint>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"
#include "ports/IDocumentView.hpp"

namespace speculum::sim {

struct SimNode {
  NodeRef id{};
  NodeKind kind{NodeKind::Element};
  ElementNs ns{ElementNs::Html};
  std::string localName;
  std::string data;
  NodeRef parent{};
  std::vector<NodeRef> children;
  std::vector<NodeRef> shadowRoots;
  std::vector<std::pair<std::string, std::string>> attrs;
};

struct SimSheet {
  SheetRef id{};
  bool disabled{false};
  std::string media;
  NodeRef owner{};
  std::vector<RuleRef> rules;
};

struct SimRule {
  RuleRef id{};
  SheetRef sheet{};
  RuleRef parent{};
  std::string type{"style"};
  std::string condition;
  std::string selector;
  std::vector<std::tuple<std::string, AtomRef, bool>> decls;
};

class SimDocumentView final : public IDocumentView {
 public:
  NodeRef ensureRoot() {
    if (root_.valid()) return root_;
    root_ = mintNode(NodeKind::Document, "html");
    return root_;
  }

  NodeRef mintNode(NodeKind kind, std::string_view name) {
    NodeRef id{++node_seq_};
    SimNode n;
    n.id = id;
    n.kind = kind;
    n.localName = std::string(name);
    nodes_[id.value()] = std::move(n);
    return id;
  }

  void appendChild(NodeRef parent, NodeRef child) {
    auto* p = node(parent);
    auto* c = node(child);
    if (!p || !c) return;
    c->parent = parent;
    p->children.push_back(child);
  }

  void insertChild(NodeRef parent, NodeRef child, uint32_t index) {
    auto* p = node(parent);
    auto* c = node(child);
    if (!p || !c) return;
    c->parent = parent;
    if (index > p->children.size()) index = uint32_t(p->children.size());
    p->children.insert(p->children.begin() + index, child);
  }

  bool removeChild(NodeRef parent, NodeRef child) {
    auto* p = node(parent);
    auto* c = node(child);
    if (!p || !c) return false;
    auto it = std::find(p->children.begin(), p->children.end(), child);
    if (it == p->children.end()) return false;
    p->children.erase(it);
    c->parent = {};
    return true;
  }

  int32_t indexOfChild(NodeRef parent, NodeRef child) const {
    const auto* p = node(parent);
    if (!p) return -1;
    for (size_t i = 0; i < p->children.size(); ++i)
      if (p->children[i] == child) return int32_t(i);
    return -1;
  }

  SheetRef mintSheet(NodeRef owner = {}) {
    SheetRef id{++sheet_seq_};
    SimSheet sh;
    sh.id = id;
    sh.owner = owner;
    sheets_[id.value()] = std::move(sh);
    sheet_order_.push_back(id);
    return id;
  }

  RuleRef mintRule(SheetRef sheet, std::string_view selector = "div") {
    RuleRef id{++rule_seq_};
    SimRule r;
    r.id = id;
    r.sheet = sheet;
    r.selector = std::string(selector);
    rules_[id.value()] = std::move(r);
    if (auto* sh = sheetMut(sheet)) sh->rules.push_back(id);
    return id;
  }

  void setSheetOwner(SheetRef s, NodeRef owner) {
    if (auto* sh = sheetMut(s)) sh->owner = owner;
  }

  bool sheetApplicable(SheetRef s) const {
    return applicable_.count(s.value()) != 0;
  }
  void setSheetApplicable(SheetRef s, bool v) {
    if (v) applicable_.insert(s.value());
    else applicable_.erase(s.value());
  }

  void setAttr(NodeRef el, std::string_view name, std::string_view value) {
    auto* n = node(el);
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
    auto* n = node(r);
    if (!n) return;
    n->data = std::string(data);
  }

  // Sim-only (port lacks isUserAgentOwned until gecko adapter).
  void setUserAgentOwned(NodeRef r, bool v) {
    if (v) ua_owned_.insert(r.value());
    else ua_owned_.erase(r.value());
  }
  bool isUserAgentOwned(NodeRef r) const {
    return ua_owned_.count(r.value()) != 0;
  }

  // Walk every node (DFS).
  template <class F>
  void forEachNode(F&& f) const {
    if (!root_.valid()) return;
    walk(root_, f);
  }

  NodeRef root() const override { return root_; }
  NodeKind kind(NodeRef r) const override {
    const auto* n = node(r);
    return n ? n->kind : NodeKind::Element;
  }
  ElementNs ns(NodeRef r) const override {
    const auto* n = node(r);
    return n ? n->ns : ElementNs::Html;
  }
  std::string_view localName(NodeRef r) const override {
    const auto* n = node(r);
    return n ? std::string_view(n->localName) : std::string_view{};
  }
  std::string_view characterData(NodeRef r) const override {
    const auto* n = node(r);
    return n ? std::string_view(n->data) : std::string_view{};
  }
  uint32_t childCount(NodeRef r) const override {
    const auto* n = node(r);
    return n ? uint32_t(n->children.size()) : 0;
  }
  NodeRef childAt(NodeRef r, uint32_t i) const override {
    const auto* n = node(r);
    if (!n || i >= n->children.size()) return {};
    return n->children[i];
  }
  NodeRef parent(NodeRef r) const override {
    const auto* n = node(r);
    return n ? n->parent : NodeRef{};
  }
  NodeRef shadowRoot(NodeRef host) const override {
    const auto* h = node(host);
    if (!h || h->shadowRoots.empty()) return {};
    return h->shadowRoots.front();
  }
  NodeRef shadowHost(NodeRef sr) const override {
    const auto* n = node(sr);
    return n ? n->parent : NodeRef{};
  }

  NodeRef attachShadow(NodeRef host) {
    auto* h = node(host);
    if (!h) return {};
    NodeRef id = mintNode(NodeKind::Document, "#shadow");
    auto* s = node(id);
    if (!s) return {};
    s->parent = host;
    h->shadowRoots.push_back(id);
    return id;
  }

  std::vector<NodeRef> shadowRootsOf(NodeRef host) const {
    const auto* h = node(host);
    return h ? h->shadowRoots : std::vector<NodeRef>{};
  }
  uint32_t attrCount(NodeRef r) const override {
    const auto* n = node(r);
    return n ? uint32_t(n->attrs.size()) : 0;
  }
  void attrAt(NodeRef r, uint32_t i, std::string_view& name,
              std::string_view& value) const override {
    const auto* n = node(r);
    if (!n || i >= n->attrs.size()) {
      name = {};
      value = {};
      return;
    }
    name = n->attrs[i].first;
    value = n->attrs[i].second;
  }
  bool attr(NodeRef r, std::string_view name, std::string_view& value) const override {
    const auto* n = node(r);
    if (!n) return false;
    for (const auto& a : n->attrs) {
      if (a.first == name) {
        value = a.second;
        return true;
      }
    }
    return false;
  }
  uint32_t sheetCount() const override { return uint32_t(sheets_.size()); }
  SheetRef sheetAt(uint32_t i) const override {
    if (i >= sheet_order_.size()) return {};
    return sheet_order_[i];
  }
  bool sheetDisabled(SheetRef s) const override {
    const auto* sh = sheet(s);
    return sh ? sh->disabled : false;
  }
  std::string_view sheetMedia(SheetRef s) const override {
    const auto* sh = sheet(s);
    return sh ? std::string_view(sh->media) : std::string_view{};
  }
  NodeRef sheetOwner(SheetRef s) const override {
    const auto* sh = sheet(s);
    return sh ? sh->owner : NodeRef{};
  }
  uint32_t ruleCount(SheetRef s) const override {
    const auto* sh = sheet(s);
    return sh ? uint32_t(sh->rules.size()) : 0;
  }
  RuleRef ruleAt(SheetRef s, uint32_t i) const override {
    const auto* sh = sheet(s);
    if (!sh || i >= sh->rules.size()) return {};
    return sh->rules[i];
  }
  RuleRef parentRule(RuleRef r) const override {
    const auto* rule = this->rule(r);
    return rule ? rule->parent : RuleRef{};
  }
  std::string_view ruleType(RuleRef r) const override {
    const auto* rule = this->rule(r);
    return rule ? std::string_view(rule->type) : std::string_view{};
  }
  std::string_view ruleCondition(RuleRef r) const override {
    const auto* rule = this->rule(r);
    return rule ? std::string_view(rule->condition) : std::string_view{};
  }
  std::string_view ruleSelector(RuleRef r) const override {
    const auto* rule = this->rule(r);
    return rule ? std::string_view(rule->selector) : std::string_view{};
  }
  uint32_t declarationCount(RuleRef r) const override {
    const auto* rule = this->rule(r);
    return rule ? uint32_t(rule->decls.size()) : 0;
  }
  void declarationAt(RuleRef r, uint32_t i, std::string_view& name, AtomRef& value,
                     bool& important) const override {
    const auto* rule = this->rule(r);
    if (!rule || i >= rule->decls.size()) {
      name = {};
      value = {};
      important = false;
      return;
    }
    name = std::get<0>(rule->decls[i]);
    value = std::get<1>(rule->decls[i]);
    important = std::get<2>(rule->decls[i]);
  }

 private:
  template <class F>
  void walk(NodeRef r, F&& f) const {
    f(r);
    uint32_t n = childCount(r);
    for (uint32_t i = 0; i < n; ++i) walk(childAt(r, i), f);
  }

  const SimNode* node(NodeRef r) const {
    auto it = nodes_.find(r.value());
    return it == nodes_.end() ? nullptr : &it->second;
  }
  SimNode* node(NodeRef r) {
    auto it = nodes_.find(r.value());
    return it == nodes_.end() ? nullptr : &it->second;
  }
  const SimSheet* sheet(SheetRef s) const {
    auto it = sheets_.find(s.value());
    return it == sheets_.end() ? nullptr : &it->second;
  }
  SimSheet* sheetMut(SheetRef s) {
    auto it = sheets_.find(s.value());
    return it == sheets_.end() ? nullptr : &it->second;
  }
  const SimRule* rule(RuleRef r) const {
    auto it = rules_.find(r.value());
    return it == rules_.end() ? nullptr : &it->second;
  }

  NodeRef root_{};
  uint32_t node_seq_{0};
  uint32_t sheet_seq_{0};
  uint32_t rule_seq_{0};
  std::unordered_map<uint32_t, SimNode> nodes_;
  std::unordered_map<uint32_t, SimSheet> sheets_;
  std::unordered_map<uint32_t, SimRule> rules_;
  std::vector<SheetRef> sheet_order_;
  std::unordered_set<uint32_t> ua_owned_;
  std::unordered_set<uint32_t> applicable_;
};

}  // namespace speculum::sim
