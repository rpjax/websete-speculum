#pragma once

#include <cstdint>
#include <string>
#include <string_view>

#include "domain/producer/Types.hpp"

namespace speculum::producer {

inline constexpr uint64_t kFnvOffset = 14695981039346656037ull;
inline constexpr uint64_t kFnvPrime = 1099511628211ull;
inline constexpr uint64_t kMask64 = 0xffffffffffffffffull;

inline uint64_t h64Bytes(const uint8_t* data, size_t len, uint64_t seed = kFnvOffset) {
  uint64_t h = seed;
  for (size_t i = 0; i < len; ++i) {
    h ^= data[i];
    h = (h * kFnvPrime) & kMask64;
  }
  return h;
}

inline uint64_t h64Str(std::string_view s, uint64_t seed = kFnvOffset) {
  return h64Bytes(reinterpret_cast<const uint8_t*>(s.data()), s.size(), seed);
}

inline uint64_t h64U32(uint32_t value, uint64_t seed = kFnvOffset) {
  uint64_t h = seed;
  h ^= (value & 0xff);
  h = (h * kFnvPrime) & kMask64;
  h ^= ((value >> 8) & 0xff);
  h = (h * kFnvPrime) & kMask64;
  h ^= ((value >> 16) & 0xff);
  h = (h * kFnvPrime) & kMask64;
  h ^= ((value >> 24) & 0xff);
  h = (h * kFnvPrime) & kMask64;
  return h;
}

inline uint64_t addMod64(uint64_t a, uint64_t b) { return (a + b) & kMask64; }
inline uint64_t subMod64(uint64_t a, uint64_t b) { return (a - b) & kMask64; }

inline FieldHash hashName(std::string_view name) {
  std::string s;
  s.push_back('\0');
  s.push_back('N');
  s.append(name);
  return h64Str(s);
}

inline FieldHash hashValue(std::string_view value) {
  std::string s;
  s.push_back('\0');
  s.push_back('V');
  s.append(value);
  return h64Str(s);
}

inline FieldHash hashAttr(std::string_view name, std::string_view value) {
  std::string s;
  s.push_back('\0');
  s.push_back('A');
  s.append(name);
  s.push_back('\1');
  s.append(value);
  return h64Str(s);
}

inline FieldHash hashProp(PropId propId, std::string_view value) {
  std::string s;
  s.push_back('\0');
  s.push_back('P');
  s.append(std::to_string(propId));
  s.push_back('\1');
  s.push_back('S');
  s.append(value);
  return h64Str(s);
}

inline FieldHash hashNs(uint8_t ns) {
  uint8_t bytes[3] = {0x00, 0x53, ns};
  return h64Bytes(bytes, 3);
}

inline uint64_t computeRowHash(uint32_t id, uint32_t kind, uint32_t parent,
                               uint32_t prevSibling, uint64_t contentHash) {
  uint64_t h = h64U32(id);
  h = h64U32(kind, h);
  h = h64U32(parent, h);
  h = h64U32(prevSibling, h);
  h ^= contentHash;
  h = (h * kFnvPrime) & kMask64;
  return h;
}

}  // namespace speculum::producer
