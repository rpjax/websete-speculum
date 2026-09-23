#pragma once

#include <cstdint>
#include <unordered_map>
#include <vector>

#include "domain/ids/Ids.hpp"

namespace speculum::gecko {

// Handle table: NodeRef ↔ raw native pointer. NEVER RefPtr/nsCOMPtr of node.
// Clear entry on NodeWillBeDestroyed / destroyNode. Leak test: size()==0 after teardown.
class RawNodeMap {
 public:
  NodeRef intern(void* raw) {
    if (!raw) return {};
    auto it = by_raw_.find(raw);
    if (it != by_raw_.end()) return it->second;
    NodeRef id{++seq_};
    by_raw_[raw] = id;
    by_id_[id.value()] = raw;
    return id;
  }

  void* resolve(NodeRef id) const {
    auto it = by_id_.find(id.value());
    return it == by_id_.end() ? nullptr : it->second;
  }

  NodeRef lookup(void* raw) const {
    auto it = by_raw_.find(raw);
    return it == by_raw_.end() ? NodeRef{} : it->second;
  }

  // NodeWillBeDestroyed / explicit teardown.
  void forgetRaw(void* raw) {
    auto it = by_raw_.find(raw);
    if (it == by_raw_.end()) return;
    by_id_.erase(it->second.value());
    by_raw_.erase(it);
  }

  void forget(NodeRef id) {
    auto it = by_id_.find(id.value());
    if (it == by_id_.end()) return;
    by_raw_.erase(it->second);
    by_id_.erase(it);
  }

  void clear() {
    by_raw_.clear();
    by_id_.clear();
  }

  size_t size() const { return by_id_.size(); }
  bool empty() const { return by_id_.empty(); }

  // Test hook: all raw pointers currently held (for leak assert).
  std::vector<void*> raws() const {
    std::vector<void*> out;
    out.reserve(by_raw_.size());
    for (const auto& [p, id] : by_raw_) {
      (void)id;
      out.push_back(p);
    }
    return out;
  }

 private:
  uint32_t seq_{0};
  std::unordered_map<void*, NodeRef> by_raw_;
  std::unordered_map<uint32_t, void*> by_id_;
};

}  // namespace speculum::gecko
