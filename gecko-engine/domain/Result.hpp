#pragma once

#include <cstdint>
#include <optional>
#include <utility>

#include "domain/fault/Fault.hpp"

namespace speculum {

template <class T>
class Result {
 public:
  static Result success(T v) {
    Result r;
    r.ok_ = true;
    r.value_ = std::move(v);
    return r;
  }
  static Result failure(fault::Fault f) {
    Result r;
    r.ok_ = false;
    r.fault_ = std::move(f);
    return r;
  }

  bool ok() const { return ok_; }
  explicit operator bool() const { return ok_; }
  T& value() { return *value_; }
  const T& value() const { return *value_; }
  const fault::Fault& fault() const { return fault_; }

 private:
  bool ok_{false};
  std::optional<T> value_;
  fault::Fault fault_{};
};

template <>
class Result<void> {
 public:
  static Result success() {
    Result r;
    r.ok_ = true;
    return r;
  }
  static Result failure(fault::Fault f) {
    Result r;
    r.ok_ = false;
    r.fault_ = std::move(f);
    return r;
  }

  bool ok() const { return ok_; }
  explicit operator bool() const { return ok_; }
  const fault::Fault& fault() const { return fault_; }

 private:
  bool ok_{false};
  fault::Fault fault_{};
};

}  // namespace speculum
