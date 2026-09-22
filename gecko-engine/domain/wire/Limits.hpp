#pragma once

#include <cstdint>

namespace speculum::wire {

// All protocol numeric ceilings live here — nowhere else.
struct Limits {
  static constexpr uint32_t kMaxPayload = 64u << 20;
  static constexpr uint32_t kMaxString = 1u << 20;
  static constexpr uint32_t kMaxSnapshot = 16u << 20;
  static constexpr uint32_t kMaxChunk = 256u << 10;
  static constexpr uint32_t kEnvelopeBytes = 16;
};

}  // namespace speculum::wire
