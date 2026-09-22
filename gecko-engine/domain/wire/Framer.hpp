#pragma once

#include <cstdint>
#include <cstring>
#include <new>
#include <span>

#include "domain/fault/Fault.hpp"
#include "domain/wire/Envelope.hpp"
#include "domain/wire/Limits.hpp"

namespace speculum::wire {

struct IEnvelopeTarget {
  virtual ~IEnvelopeTarget() = default;
  virtual void onEnvelope(const Envelope& env, std::span<const uint8_t> payload) = 0;
  virtual void onFramingLost(speculum::fault::Fault fault) = 0;
};

// Session-scoped. Bytes in → envelopes out. Partition-independent delivery.
class Framer {
 public:
  // One envelope header + max payload. Heap — never on the stack.
  static constexpr std::size_t kCap = std::size_t(Limits::kMaxPayload) + Limits::kEnvelopeBytes;

  explicit Framer(IEnvelopeTarget& target)
      : target_(target), buf_(new (std::nothrow) uint8_t[kCap]), len_(0), lost_(false) {
    if (!buf_) {
      lost_ = true;
    }
  }

  ~Framer() { delete[] buf_; }

  Framer(const Framer&) = delete;
  Framer& operator=(const Framer&) = delete;

  void feed(std::span<const uint8_t> chunk) {
    if (lost_ || !buf_) return;
    if (chunk.empty()) return;
    if (len_ + chunk.size() > kCap) {
      lose(speculum::fault::makeFault(speculum::fault::FaultCode::CeilingExceeded, "Framer",
                                      "framer buffer exceeded"));
      return;
    }
    std::memcpy(buf_ + len_, chunk.data(), chunk.size());
    len_ += chunk.size();
    for (;;) {
      if (len_ < Limits::kEnvelopeBytes) return;
      Envelope env{};
      env.opcode = rd16(0);
      env.reserved = rd16(2);
      env.target = rd32(4);
      env.length = rd32(8);
      env.correlation = rd32(12);
      if (env.length > Limits::kMaxPayload) {
        lose(speculum::fault::makeFault(speculum::fault::FaultCode::CeilingExceeded, "Framer",
                                        "payload exceeds kMaxPayload"));
        return;
      }
      const std::size_t total = Limits::kEnvelopeBytes + std::size_t(env.length);
      if (len_ < total) return;
      auto payload = std::span<const uint8_t>(buf_ + Limits::kEnvelopeBytes, env.length);
      target_.onEnvelope(env, payload);
      const std::size_t rest = len_ - total;
      if (rest) std::memmove(buf_, buf_ + total, rest);
      len_ = rest;
    }
  }

  std::size_t buffered() const { return len_; }
  bool framingLost() const { return lost_; }

 private:
  uint16_t rd16(std::size_t o) const {
    return uint16_t(buf_[o]) | (uint16_t(buf_[o + 1]) << 8);
  }
  uint32_t rd32(std::size_t o) const {
    return uint32_t(buf_[o]) | (uint32_t(buf_[o + 1]) << 8) |
           (uint32_t(buf_[o + 2]) << 16) | (uint32_t(buf_[o + 3]) << 24);
  }

  void lose(speculum::fault::Fault f) {
    lost_ = true;
    len_ = 0;
    target_.onFramingLost(f);
  }

  IEnvelopeTarget& target_;
  uint8_t* buf_;
  std::size_t len_;
  bool lost_;
};

}  // namespace speculum::wire
