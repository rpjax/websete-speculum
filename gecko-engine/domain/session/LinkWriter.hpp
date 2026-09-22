#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <span>
#include <vector>

#include "domain/wire/Envelope.hpp"
#include "domain/wire/Limits.hpp"
#include "ports/ILink.hpp"

namespace speculum::session {

struct IEmitGate {
  virtual ~IEmitGate() = default;
  virtual bool mayEmit() const = 0;
  virtual void onWriteBroken() = 0;
};

// One envelope in flight. Not a queue.
class LinkWriter {
 public:
  LinkWriter(ILink& link, IEmitGate& gate) : link_(link), gate_(gate) {}

  // false = busy (never blocks).
  bool offer(const wire::Envelope& env, std::span<const uint8_t> payload) {
    if (closed_) return false;
    if (!gate_.mayEmit()) return false;
    if (!idle_) return false;
    pending_.clear();
    wire::Envelope e = env;
    e.length = static_cast<uint32_t>(payload.size());
    appendHeader(pending_, e);
    pending_.insert(pending_.end(), payload.begin(), payload.end());
    offset_ = 0;
    idle_ = false;
    pump();
    return true;
  }

  void onWritable() {
    if (idle_ || closed_) return;
    pump();
  }

  bool isIdle() const { return idle_; }
  std::size_t pendingBytes() const {
    return idle_ ? 0 : (pending_.size() - offset_);
  }

  void seal() { closed_ = true; }  // after Dead — no more writes

 private:
  void appendHeader(std::vector<uint8_t>& out, const wire::Envelope& env) {
    auto put16 = [&](uint16_t v) {
      out.push_back(uint8_t(v));
      out.push_back(uint8_t(v >> 8));
    };
    auto put32 = [&](uint32_t v) {
      out.push_back(uint8_t(v));
      out.push_back(uint8_t(v >> 8));
      out.push_back(uint8_t(v >> 16));
      out.push_back(uint8_t(v >> 24));
    };
    put16(env.opcode);
    put16(env.reserved);
    put32(env.target);
    put32(env.length);
    put32(env.correlation);
  }

  void pump() {
    while (!idle_ && !closed_) {
      const std::size_t left = pending_.size() - offset_;
      if (left == 0) {
        idle_ = true;
        pending_.clear();
        offset_ = 0;
        return;
      }
      auto slice = std::span<const uint8_t>(pending_.data() + offset_, left);
      WriteResult r = link_.write(slice);
      if (r.outcome == WriteOutcome::Broken) {
        closed_ = true;
        idle_ = true;
        gate_.onWriteBroken();
        return;
      }
      if (r.outcome == WriteOutcome::WouldBlock) {
        return;
      }
      offset_ += r.written;
      if (offset_ >= pending_.size()) {
        idle_ = true;
        pending_.clear();
        offset_ = 0;
        return;
      }
      if (r.written == 0) return;
    }
  }

  ILink& link_;
  IEmitGate& gate_;
  std::vector<uint8_t> pending_;
  std::size_t offset_{0};
  bool idle_{true};
  bool closed_{false};
};

}  // namespace speculum::session
