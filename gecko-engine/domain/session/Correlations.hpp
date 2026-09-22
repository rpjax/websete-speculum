#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <vector>

#include "domain/ids/Ids.hpp"

namespace speculum::session {

enum class PendingKind : uint8_t {
  Navigate = 1,
  ViewportOpen = 2,
  Snapshot = 3,
  FreezeAll = 4,
  CaptureState = 5,
  Probe = 6,
};

struct Pending {
  CorrelationId id{0};
  PendingKind kind{};
  HostId host{};
  Generation generation{};
};

class Correlations {
 public:
  void remember(CorrelationId id, PendingKind kind, HostId host, Generation gen) {
    items_.push_back(Pending{id, kind, host, gen});
  }

  std::optional<Pending> take(CorrelationId id) {
    for (std::size_t i = 0; i < items_.size(); ++i) {
      if (items_[i].id == id) {
        Pending p = items_[i];
        items_.erase(items_.begin() + static_cast<std::ptrdiff_t>(i));
        return p;
      }
    }
    ++orphan_takes_;
    return std::nullopt;
  }

  void forgetHost(HostId host, Generation gen) {
    items_.erase(std::remove_if(items_.begin(), items_.end(),
                                 [&](const Pending& p) {
                                   return p.host == host && p.generation == gen;
                                 }),
                 items_.end());
  }

  std::size_t pending() const { return items_.size(); }
  int orphanTakes() const { return orphan_takes_; }
  const std::vector<Pending>& items() const { return items_; }

 private:
  std::vector<Pending> items_;
  int orphan_takes_{0};
};

}  // namespace speculum::session
