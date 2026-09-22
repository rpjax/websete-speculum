#pragma once

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <unordered_map>
#include <vector>

#include "domain/Types.hpp"
#include "domain/documents/NavigationState.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

struct HostNode {
  HostId id{};
  HostId parent{};  // invalid → root of a viewport (position, not category)
  ViewportId viewport{};
  Generation generation{};  // 0 = empty slot
  Extent extent{};
  NavigationState nav{};
};

class Hosts {
 public:
  void attach(const HostNode& node) {
    assert(node.id.valid());
    assert(nodes_.find(node.id.value()) == nodes_.end());
    nodes_[node.id.value()] = node;
    if (node.parent.valid()) {
      children_[node.parent.value()].push_back(node.id);
    }
  }

  // Close subtree: collect all ids, then erase. One rule for all hosts.
  std::vector<HostId> detach(HostId root) {
    std::vector<HostId> order;
    collectSubtree(root, order);
    for (auto id : order) {
      auto it = nodes_.find(id.value());
      if (it == nodes_.end()) continue;
      HostId parent = it->second.parent;
      nodes_.erase(it);
      children_.erase(id.value());
      if (parent.valid()) {
        auto& sibs = children_[parent.value()];
        sibs.erase(std::remove(sibs.begin(), sibs.end(), id), sibs.end());
      }
    }
    return order;
  }

  HostNode* find(HostId id) {
    auto it = nodes_.find(id.value());
    return it == nodes_.end() ? nullptr : &it->second;
  }
  const HostNode* find(HostId id) const {
    auto it = nodes_.find(id.value());
    return it == nodes_.end() ? nullptr : &it->second;
  }

  void installDocument(HostId host, Generation gen) {
    auto* n = find(host);
    assert(n);
    n->generation = gen;
  }

  void discardDocument(HostId host) {
    auto* n = find(host);
    assert(n);
    n->generation = Generation{0};
  }

  template <class F>
  void forEachChild(HostId parent, F&& f) const {
    auto it = children_.find(parent.value());
    if (it == children_.end()) return;
    for (auto c : it->second) f(c);
  }

  template <class F>
  void forEachInSubtree(HostId root, F&& f) const {
    std::vector<HostId> order;
    collectSubtree(root, order);
    for (auto id : order) f(id);
  }

  bool checkInvariants() const {
    for (const auto& [k, n] : nodes_) {
      (void)k;
      if (!n.id.valid()) return false;
      if (n.parent.valid()) {
        if (!find(n.parent)) return false;
        auto it = children_.find(n.parent.value());
        if (it == children_.end()) return false;
        bool listed = false;
        for (auto c : it->second)
          if (c == n.id) listed = true;
        if (!listed) return false;
      }
      if (!n.viewport.valid()) return false;
    }
    for (const auto& [k, n] : nodes_) {
      (void)k;
      uint32_t guard = 0;
      HostId p = n.parent;
      while (p.valid()) {
        if (++guard > nodes_.size()) return false;
        if (p == n.id) return false;
        const auto* pn = find(p);
        if (!pn) return false;
        p = pn->parent;
      }
    }
    return true;
  }

  std::size_t size() const { return nodes_.size(); }

  template <class F>
  void forEach(F&& f) const {
    for (const auto& [k, n] : nodes_) {
      (void)k;
      f(n);
    }
  }

 private:
  void collectSubtree(HostId root, std::vector<HostId>& out) const {
    out.push_back(root);
    auto it = children_.find(root.value());
    if (it == children_.end()) return;
    for (auto c : it->second) collectSubtree(c, out);
  }

  std::unordered_map<uint32_t, HostNode> nodes_;
  std::unordered_map<uint32_t, std::vector<HostId>> children_;
};

}  // namespace speculum
