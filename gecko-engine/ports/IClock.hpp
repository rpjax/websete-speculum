#pragma once

#include <cstdint>

namespace speculum {

using Millis = uint64_t;
using TimerId = uint32_t;  // 0 = invalid

struct ITimerTarget {
  virtual ~ITimerTarget() = default;
  virtual void onTimerFired(TimerId) = 0;
};

struct IClock {
  virtual ~IClock() = default;
  virtual Millis now() const = 0;
  virtual TimerId scheduleOnce(Millis delay, ITimerTarget*) = 0;
  virtual void cancel(TimerId) = 0;
};

}  // namespace speculum
