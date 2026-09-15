/* Speculum — lê o env uma vez. Depois só atomic. */
#include "SpeculumCaps.h"

#include "mozilla/Atomics.h"
#include "mozilla/Likely.h"
#include "prenv.h"

namespace {

constexpr uint32_t kInited = 1u;
constexpr uint32_t kEvents = 2u;
constexpr uint32_t kMetrics = 4u;

mozilla::Atomic<uint32_t> gCaps{0};

bool EnvOn(const char* aName) {
  const char* v = PR_GetEnv(aName);
  return v && v[0] && v[0] != '0';
}

uint32_t LoadCaps() {
  uint32_t v = gCaps;
  if (MOZ_LIKELY(v != 0)) {
    return v;
  }
  uint32_t caps = kInited;
  if (EnvOn("SPECULUM_CAP_EVENTS")) {
    caps |= kEvents;
  }
  if (EnvOn("SPECULUM_CAP_METRICS")) {
    caps |= kMetrics;
  }
  gCaps = caps;
  return caps;
}

}  // namespace

bool SpeculumEventsOn() {
  return MOZ_UNLIKELY((LoadCaps() & kEvents) != 0);
}

bool SpeculumMetricsOn() {
  return MOZ_UNLIKELY((LoadCaps() & kMetrics) != 0);
}
