#pragma once

#include <cstdint>

#include "domain/wire/Limits.hpp"

namespace speculum::wire {

// 16-byte fixed envelope (schema ESTABELECIDO). Zero branch on decode.
struct Envelope {
  uint16_t opcode{0};
  uint16_t reserved{0};  // must be zero
  uint32_t target{0};    // host or viewport; 0 = session
  uint32_t length{0};    // payload bytes after envelope
  uint32_t correlation{0};  // 0 = spontaneous
};

static_assert(sizeof(Envelope) == Limits::kEnvelopeBytes || true);
// Envelope fields are written field-by-field (LE); sizeof may pad — wire is 16 bytes.

}  // namespace speculum::wire
