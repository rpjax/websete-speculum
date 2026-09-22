#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

#include "ports/ILink.hpp"

namespace speculum {

// Test double: scripted write outcomes + injectable ingress.
class ScriptedLink final : public ILink {
 public:
  void script(std::vector<WriteResult> results) { script_ = std::move(results); script_i_ = 0; }

  void pushBytes(std::span<const uint8_t> b) {
    if (broken_ || !sink_) return;
    sink_->onBytes(b);
  }

  void signalWritable() {
    if (broken_ || !sink_) return;
    sink_->onWritable();
  }

  void signalBroken() {
    if (broken_) return;
    broken_ = true;
    open_ = false;
    if (sink_ && !broken_notified_) {
      broken_notified_ = true;
      sink_->onBroken();
    }
  }

  const std::vector<uint8_t>& written() const { return written_; }
  std::size_t writeCalls() const { return write_calls_; }
  std::size_t writeCallsAfterBroken() const { return write_after_broken_; }
  int brokenNotifyCount() const { return broken_notify_count_; }

  WriteResult write(std::span<const uint8_t> data) override {
    ++write_calls_;
    if (broken_) {
      ++write_after_broken_;
      return {WriteOutcome::Broken, 0};
    }
    WriteResult r{WriteOutcome::Complete, data.size()};
    if (script_i_ < script_.size()) {
      r = script_[script_i_++];
    }
    if (r.outcome == WriteOutcome::Broken) {
      broken_ = true;
      open_ = false;
      const std::size_t n = r.written <= data.size() ? r.written : data.size();
      if (n) written_.insert(written_.end(), data.begin(), data.begin() + static_cast<std::ptrdiff_t>(n));
      if (sink_ && !broken_notified_) {
        broken_notified_ = true;
        ++broken_notify_count_;
        sink_->onBroken();
      }
      return r;
    }
    if (r.outcome == WriteOutcome::WouldBlock) {
      r.written = 0;
      return r;
    }
    std::size_t n = r.written;
    if (r.outcome == WriteOutcome::Complete) n = data.size();
    if (n > data.size()) n = data.size();
    if (n) written_.insert(written_.end(), data.begin(), data.begin() + static_cast<std::ptrdiff_t>(n));
    r.written = n;
    return r;
  }

  void attach(ILinkSink* sink) override { sink_ = sink; }
  void close() override { open_ = false; }
  bool isOpen() const override { return open_ && !broken_; }

 private:
  ILinkSink* sink_{nullptr};
  std::vector<WriteResult> script_;
  std::size_t script_i_{0};
  std::vector<uint8_t> written_;
  std::size_t write_calls_{0};
  std::size_t write_after_broken_{0};
  bool broken_{false};
  bool broken_notified_{false};
  int broken_notify_count_{0};
  bool open_{true};
};

}  // namespace speculum
