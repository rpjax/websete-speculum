#pragma once

#include <cstdint>
#include <cstring>
#include <span>
#include <string_view>

namespace speculum::wire {

// Sticky-failure cursor. After the first overrun, ok() stays false and all ops fail.
class Reader {
 public:
  explicit Reader(std::span<const uint8_t> buf) : buf_(buf), o_(0), ok_(true) {}

  bool ok() const { return ok_; }

  bool u8(uint8_t& out) {
    if (!need(1)) return false;
    out = buf_[o_++];
    return true;
  }
  bool u16(uint16_t& out) {
    if (!need(2)) return false;
    out = static_cast<uint16_t>(buf_[o_] | (uint16_t(buf_[o_ + 1]) << 8));
    o_ += 2;
    return true;
  }
  bool u32(uint32_t& out) {
    if (!need(4)) return false;
    out = uint32_t(buf_[o_]) | (uint32_t(buf_[o_ + 1]) << 8) |
          (uint32_t(buf_[o_ + 2]) << 16) | (uint32_t(buf_[o_ + 3]) << 24);
    o_ += 4;
    return true;
  }
  bool u64(uint64_t& out) {
    uint32_t lo = 0, hi = 0;
    if (!u32(lo) || !u32(hi)) return false;
    out = uint64_t(lo) | (uint64_t(hi) << 32);
    return true;
  }
  bool i32(int32_t& out) {
    uint32_t u = 0;
    if (!u32(u)) return false;
    out = static_cast<int32_t>(u);
    return true;
  }
  bool boolean(bool& out) {
    uint8_t v = 0;
    if (!u8(v)) return false;
    out = v != 0;
    return true;
  }
  bool str(std::string_view& out) {
    uint32_t n = 0;
    if (!u32(n)) return false;
    if (!need(n)) return false;
    out = std::string_view(reinterpret_cast<const char*>(buf_.data() + o_), n);
    o_ += n;
    return true;
  }
  bool bytes(std::span<const uint8_t>& out) {
    uint32_t n = 0;
    if (!u32(n)) return false;
    if (!need(n)) return false;
    out = buf_.subspan(o_, n);
    o_ += n;
    return true;
  }

 private:
  bool need(std::size_t n) {
    if (!ok_) return false;
    if (o_ + n > buf_.size()) {
      ok_ = false;
      return false;
    }
    return true;
  }

  std::span<const uint8_t> buf_;
  std::size_t o_;
  bool ok_;
};

class Writer {
 public:
  explicit Writer(std::span<uint8_t> buf) : buf_(buf), o_(0), ok_(true) {}

  bool ok() const { return ok_; }
  std::size_t length() const { return o_; }
  std::span<const uint8_t> written() const { return buf_.first(o_); }

  bool u8(uint8_t v) {
    if (!need(1)) return false;
    buf_[o_++] = v;
    return true;
  }
  bool u16(uint16_t v) {
    if (!need(2)) return false;
    buf_[o_++] = uint8_t(v);
    buf_[o_++] = uint8_t(v >> 8);
    return true;
  }
  bool u32(uint32_t v) {
    if (!need(4)) return false;
    buf_[o_++] = uint8_t(v);
    buf_[o_++] = uint8_t(v >> 8);
    buf_[o_++] = uint8_t(v >> 16);
    buf_[o_++] = uint8_t(v >> 24);
    return true;
  }
  bool u64(uint64_t v) {
    return u32(uint32_t(v)) && u32(uint32_t(v >> 32));
  }
  bool i32(int32_t v) { return u32(uint32_t(v)); }
  bool boolean(bool v) { return u8(v ? 1 : 0); }
  bool str(std::string_view v) {
    if (v.size() > 0xffffffffu) {
      ok_ = false;
      return false;
    }
    if (!u32(uint32_t(v.size()))) return false;
    if (!need(v.size())) return false;
    if (!v.empty()) {
      std::memcpy(buf_.data() + o_, v.data(), v.size());
    }
    o_ += v.size();
    return true;
  }
  bool bytes(std::span<const uint8_t> v) {
    if (v.size() > 0xffffffffu) {
      ok_ = false;
      return false;
    }
    if (!u32(uint32_t(v.size()))) return false;
    if (!need(v.size())) return false;
    if (!v.empty()) {
      std::memcpy(buf_.data() + o_, v.data(), v.size());
    }
    o_ += v.size();
    return true;
  }

 private:
  bool need(std::size_t n) {
    if (!ok_) return false;
    if (o_ + n > buf_.size()) {
      ok_ = false;
      return false;
    }
    return true;
  }

  std::span<uint8_t> buf_;
  std::size_t o_;
  bool ok_;
};

}  // namespace speculum::wire
