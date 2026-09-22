#pragma once

#include <cstdint>
#include <vector>

#include "domain/fault/Fault.hpp"
#include "domain/session/Correlations.hpp"

namespace speculum::session {

enum class Phase : uint8_t {
  Booting = 0,
  Linked = 1,
  Ready = 2,
  Terminating = 3,
  Dead = 4,
};

struct DeathDump {
  Phase phase{Phase::Booting};
  fault::Fault killer{};
  bool has_killer{false};
  std::size_t correlations_pending{0};
  std::vector<Pending> correlations{};
  bool writer_idle{true};
  std::size_t writer_pending_bytes{0};
  // Phase 3+: hosts / documents / streams
};

struct IDeathDumpSink {
  virtual ~IDeathDumpSink() = default;
  virtual void onDeathDump(const DeathDump&) = 0;
};

}  // namespace speculum::session
