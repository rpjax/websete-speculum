#pragma once

#include <algorithm>
#include <cstdint>
#include <vector>

#include "ports/IClock.hpp"

namespace speculum {

struct ManualClock final : public IClock {
  Millis now() const override { return now_; }

  TimerId scheduleOnce(Millis delay, ITimerTarget* target) override {
    const TimerId id = ++next_id_;
    timers_.push_back(Entry{id, now_ + delay, target, true});
    return id;
  }

  void cancel(TimerId id) override {
    for (auto& t : timers_) {
      if (t.id == id) t.alive = false;
    }
  }

  // Advance time and fire due timers (main thread).
  void advance(Millis delta) {
    now_ += delta;
    // Fire in deadline order; copy ids to avoid reentrancy issues with reschedule.
    for (;;) {
      Entry* best = nullptr;
      for (auto& t : timers_) {
        if (!t.alive || !t.target) continue;
        if (t.deadline > now_) continue;
        if (!best || t.deadline < best->deadline ||
            (t.deadline == best->deadline && t.id < best->id)) {
          best = &t;
        }
      }
      if (!best) break;
      const TimerId id = best->id;
      ITimerTarget* target = best->target;
      best->alive = false;
      target->onTimerFired(id);
    }
  }

  void setNow(Millis t) {
    if (t >= now_) now_ = t;
  }

 private:
  struct Entry {
    TimerId id;
    Millis deadline;
    ITimerTarget* target;
    bool alive;
  };

  Millis now_{0};
  TimerId next_id_{0};
  std::vector<Entry> timers_;
};

}  // namespace speculum
