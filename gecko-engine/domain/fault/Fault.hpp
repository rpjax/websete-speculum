#pragma once

#include <cstdint>

#include "domain/wire/gen/SpeculumWire.gen.hpp"

namespace speculum::fault {

using FaultCode = speculum::wire::FaultCode;
using FaultKey = speculum::wire::FaultKey;
using ValueTag = speculum::wire::ValueTag;

enum class FaultAction : uint8_t {
  Report = 0,
  DropDocument = 1,
  DropStream = 2,
  KillSession = 3,
};

enum FaultFlags : uint32_t {
  Transient = 1u << 0,
  Retryable = 1u << 1,
  ProtocolViolation = 1u << 2,
  ClientVisible = 1u << 3,
};

struct FaultDatum {
  FaultKey key{};
  ValueTag tag{};
  uint64_t num{0};
  const char* text{nullptr};  // only when tag == Str; static lifetime
};

struct Fault {
  FaultCode code{};
  uint32_t flags{0};
  const char* origin{""};
  const char* message{""};
  uint8_t count{0};
  FaultDatum data[8]{};
};

FaultAction actionOf(FaultCode code);

inline Fault makeFault(FaultCode code, const char* origin, const char* message,
                       uint32_t flags = 0) {
  Fault f{};
  f.code = code;
  f.flags = flags;
  f.origin = origin;
  f.message = message;
  return f;
}

}  // namespace speculum::fault
