#pragma once

#include <cstdint>

#include "domain/producer/DirtyLedger.hpp"
#include "ports/IClock.hpp"
#include "ports/IPatchUplink.hpp"

namespace speculum::producer {

class PatchClock final : public ITimerTarget {
 public:
  using FlushFn = void (*)(void*);

  PatchClock(IClock& clock, IPatchUplink& uplink, Millis interval, FlushFn flush,
             void* flushCtx)
      : clock_(clock),
        uplink_(uplink),
        interval_(interval),
        flush_(flush),
        flush_ctx_(flushCtx) {}

  void onDirty() {
    dirty_ = true;
    if (halted_) return;
    arm();
  }

  void halt() {
    halted_ = true;
    disarm();
  }

  void resume() {
    halted_ = false;
    if (dirty_) {
      // Exactly one patch for accumulated dirt.
      tryFlush();
    }
  }

  void flushNow() { tryFlush(); }

  void onTimerFired(TimerId id) override {
    if (id != timer_) return;
    timer_ = 0;
    armed_ = false;
    tryFlush();
  }

  bool halted() const { return halted_; }
  bool dirty() const { return dirty_; }

 private:
  void arm() {
    if (armed_ || halted_) return;
    timer_ = clock_.scheduleOnce(interval_, this);
    armed_ = true;
  }

  void disarm() {
    if (timer_) {
      clock_.cancel(timer_);
      timer_ = 0;
    }
    armed_ = false;
  }

  void tryFlush() {
    if (!dirty_) return;
    if (!uplink_.isDrained()) {
      // Keep coalescing; re-arm to retry.
      arm();
      return;
    }
    dirty_ = false;
    if (flush_) flush_(flush_ctx_);
  }

  IClock& clock_;
  IPatchUplink& uplink_;
  Millis interval_;
  FlushFn flush_;
  void* flush_ctx_;
  bool dirty_{false};
  bool halted_{false};
  bool armed_{false};
  TimerId timer_{0};
};

}  // namespace speculum::producer
