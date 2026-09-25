#pragma once

#include <cstddef>
#include <cstdint>

namespace speculum::producer {

// Launch parameters — defaults with written method (fase11-afinacao.md).
// Local measurement for bottleneck finding; not a performance acceptance gate.

// PatchClock cadence (ms). Same-run coalescence under burst.
inline constexpr uint32_t kPatchClockIntervalMs = 16;

// Max bytes for one patch assembly buffer. Fault path if exceeded (no second path).
// Sized above measured same-run peak with headroom.
inline constexpr std::size_t kScratchCapacityBytes = 256u * 1024u;

}  // namespace speculum::producer
