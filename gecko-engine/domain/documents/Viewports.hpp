#pragma once

#include <cassert>
#include <cstddef>
#include <unordered_map>
#include <vector>

#include "domain/Types.hpp"
#include "domain/documents/Hosts.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

struct ViewportRecord {
  ViewportId id{};
  Extent extent{};
  HostId root{};
};

class Viewports {
 public:
  explicit Viewports(Hosts& hosts) : hosts_(hosts) {}

  ViewportId open(Extent extent, HostId root) {
    auto id = minter_.mint();
    assert(root.valid());
    records_[id.value()] = ViewportRecord{id, extent, root};
    return id;
  }

  // Closes tree via Hosts::detach(root). Returns detached host ids.
  std::vector<HostId> close(ViewportId id) {
    auto it = records_.find(id.value());
    assert(it != records_.end());
    HostId root = it->second.root;
    records_.erase(it);
    return hosts_.detach(root);
  }

  // Drop record without detach (host tree already gone).
  void forget(ViewportId id) { records_.erase(id.value()); }

  const ViewportRecord* find(ViewportId id) const {
    auto it = records_.find(id.value());
    return it == records_.end() ? nullptr : &it->second;
  }

  ViewportRecord* find(ViewportId id) {
    auto it = records_.find(id.value());
    return it == records_.end() ? nullptr : &it->second;
  }

  std::size_t size() const { return records_.size(); }

  bool checkInvariants() const {
    for (const auto& [k, v] : records_) {
      (void)k;
      if (!v.id.valid() || !v.root.valid()) return false;
      const auto* root = hosts_.find(v.root);
      if (!root) return false;
      if (root->parent.valid()) return false;
      if (root->viewport != v.id) return false;
    }
    return true;
  }

 private:
  Hosts& hosts_;
  ViewportMinter minter_;
  std::unordered_map<uint32_t, ViewportRecord> records_;
};

}  // namespace speculum
