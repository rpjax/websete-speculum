#pragma once

#include <cstddef>
#include <cstdint>
#include <span>

namespace speculum {

enum class WriteOutcome : uint8_t {
  Complete = 0,
  Partial = 1,
  WouldBlock = 2,
  Broken = 3,
};

struct WriteResult {
  WriteOutcome outcome{WriteOutcome::Complete};
  std::size_t written{0};
};

struct ILinkSink {
  virtual ~ILinkSink() = default;
  virtual void onBytes(std::span<const uint8_t>) = 0;
  virtual void onWritable() = 0;
  virtual void onBroken() = 0;
};

struct ILink {
  virtual ~ILink() = default;
  virtual WriteResult write(std::span<const uint8_t>) = 0;
  virtual void attach(ILinkSink*) = 0;
  virtual void close() = 0;
  virtual bool isOpen() const = 0;
};

}  // namespace speculum
