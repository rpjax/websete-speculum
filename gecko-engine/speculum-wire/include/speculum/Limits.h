// frame-protocol.md §8 — os mesmos tetos do cliente (`core/limits.ts`).
// Quem emite checa antes de alocar. Quem aplica recusa o que passou.
#pragma once

#include <cstdint>
#include <cstddef>

namespace speculum {

inline constexpr uint32_t kMaxStrBytes = 1u << 20;
inline constexpr uint32_t kMaxAttrs = 1024;
inline constexpr uint32_t kMaxChildrenPerOp = 8192;
inline constexpr uint32_t kMaxOpsPerFrame = 65536;
inline constexpr uint32_t kMaxFrameBytes = 1u << 20;
inline constexpr uint32_t kMaxRows = 200000;
inline constexpr uint32_t kMaxDirtyNodes = 20000;
inline constexpr uint32_t kNodeDropAgeSequences = 20;
inline constexpr uint32_t kMaxNodeDropsPerSweep = 500;

inline constexpr uint32_t kCreditFramesDefault = 8;
inline constexpr uint32_t kCreditBytesDefault = 256u * 1024u;

}  // namespace speculum
