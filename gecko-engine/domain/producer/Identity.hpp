#pragma once

#include <cassert>
#include <cstdint>
#include <unordered_map>

#include "domain/producer/Types.hpp"

namespace speculum::producer {

class Identity {
 public:
  NodeId assign(OpaqueRef handle, KeySpace space) {
    auto& map = maps_[static_cast<int>(space)];
    auto it = map.find(handle);
    if (it != map.end()) return it->second;
    NodeId id = ++next_[static_cast<int>(space)];
    map[handle] = id;
    reverse_[pack(space, id)] = handle;
    return id;
  }

  NodeId lookup(OpaqueRef handle, KeySpace space) const {
    auto it = maps_[static_cast<int>(space)].find(handle);
    return it == maps_[static_cast<int>(space)].end() ? 0 : it->second;
  }

  OpaqueRef resolve(NodeId id, KeySpace space = KeySpace::Node) const {
    auto it = reverse_.find(pack(space, id));
    return it == reverse_.end() ? 0 : it->second;
  }

  void forget(NodeId id, KeySpace space = KeySpace::Node) {
    auto rit = reverse_.find(pack(space, id));
    if (rit == reverse_.end()) return;
    OpaqueRef h = rit->second;
    reverse_.erase(rit);
    maps_[static_cast<int>(space)].erase(h);
  }

  size_t live(KeySpace space) const {
    return maps_[static_cast<int>(space)].size();
  }

  bool checkInvariants() const {
    for (int s = 0; s < 3; ++s) {
      for (const auto& [h, id] : maps_[s]) {
        auto rit = reverse_.find(pack(static_cast<KeySpace>(s), id));
        if (rit == reverse_.end() || rit->second != h) return false;
      }
    }
    return true;
  }

 private:
  static uint64_t pack(KeySpace s, NodeId id) {
    return (uint64_t(static_cast<uint8_t>(s)) << 32) | id;
  }

  std::unordered_map<OpaqueRef, NodeId> maps_[3];
  std::unordered_map<uint64_t, OpaqueRef> reverse_;
  NodeId next_[3]{0, 0, 0};
};

}  // namespace speculum::producer
