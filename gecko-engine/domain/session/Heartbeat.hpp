#pragma once

#include <cstdint>
#include <vector>

#include "domain/session/LinkWriter.hpp"
#include "domain/wire/Cursor.hpp"
#include "domain/wire/Envelope.hpp"
#include "domain/wire/gen/SpeculumWire.gen.hpp"
#include "ports/IClock.hpp"

namespace speculum::session {

struct ISessionPhase {
  virtual ~ISessionPhase() = default;
  virtual bool mayEmit() const = 0;
  virtual bool isReady() const = 0;
};

class HeartbeatService final : public ITimerTarget {
 public:
  HeartbeatService(IClock& clock, LinkWriter& writer, ISessionPhase& session, Millis interval)
      : clock_(clock), writer_(writer), session_(session), interval_(interval) {}

  void start() {
    if (timer_ != 0) clock_.cancel(timer_);
    timer_ = clock_.scheduleOnce(interval_, this);
  }

  void stop() {
    if (timer_ != 0) {
      clock_.cancel(timer_);
      timer_ = 0;
    }
  }

  int beatCount() const { return beats_; }
  const std::vector<uint64_t>& monotonicSamples() const { return samples_; }

  void onTimerFired(TimerId id) override {
    if (id != timer_) return;
    timer_ = 0;
    if (!session_.isReady() || !session_.mayEmit()) return;
    wire::Heartbeat msg{};
    msg.monotonicMs = clock_.now();
    uint8_t buf[32];
    wire::Writer w(buf);
    if (!wire::encode_Heartbeat(w, msg)) return;
    wire::Envelope env{};
    env.opcode = wire::Heartbeat::kOpcode;
    if (!writer_.offer(env, w.written())) return;
    ++beats_;
    samples_.push_back(msg.monotonicMs);
    timer_ = clock_.scheduleOnce(interval_, this);
  }

 private:
  IClock& clock_;
  LinkWriter& writer_;
  ISessionPhase& session_;
  Millis interval_;
  TimerId timer_{0};
  int beats_{0};
  std::vector<uint64_t> samples_;
};

}  // namespace speculum::session
