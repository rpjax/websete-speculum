// Speculum — H64 primitives for the replicated table.
// Port exato de packages/page-projection/src/core/rowHash.ts (frame-protocol.md §1.5).
// Qualquer divergência aqui quebra `preTableHash`/CHECK silenciosamente: não "melhorar".
#pragma once
#include <cstdint>
#include <cstddef>
#include <string>
#include <unordered_map>

namespace speculum {

inline constexpr uint64_t kFnvOffsetBasis = 14695981039346656037ULL;
inline constexpr uint64_t kFnvPrime = 1099511628211ULL;

// FNV-1a-64. Aritmética uint64 já trunca em 2^64 — equivalente ao `& MASK64` do TS.
inline uint64_t h64Bytes(const uint8_t* data, size_t len, uint64_t seed = kFnvOffsetBasis) {
  uint64_t h = seed;
  for (size_t i = 0; i < len; ++i) {
    h ^= static_cast<uint64_t>(data[i]);
    h *= kFnvPrime;
  }
  return h;
}

inline uint64_t h64Str(const std::string& s, uint64_t seed = kFnvOffsetBasis) {
  return h64Bytes(reinterpret_cast<const uint8_t*>(s.data()), s.size(), seed);
}

// u32 como 4 bytes little-endian.
inline uint64_t h64U32(uint32_t v, uint64_t seed = kFnvOffsetBasis) {
  uint64_t h = seed;
  for (int i = 0; i < 4; ++i) {
    h ^= static_cast<uint64_t>((v >> (8 * i)) & 0xff);
    h *= kFnvPrime;
  }
  return h;
}

// Contribuições por campo para o contentHash. O byte de tag impede colisão estrutural.
inline uint64_t hashName(const std::string& name) {
  std::string s;
  s.push_back('\0');
  s.push_back('N');
  s += name;
  return h64Str(s);
}

inline uint64_t hashValue(const std::string& value) {
  std::string s;
  s.push_back('\0');
  s.push_back('V');
  s += value;
  return h64Str(s);
}

inline uint64_t hashAttr(const std::string& name, const std::string& value) {
  std::string s;
  s.push_back('\0');
  s.push_back('A');
  s += name;
  s.push_back('\1');
  s += value;
  return h64Str(s);
}

// PROP_SET: só 'str' e 'bool' existem na ISA selada (propSet.ts).
inline uint64_t hashPropStr(uint8_t propId, const std::string& value) {
  std::string s;
  s.push_back('\0');
  s.push_back('P');
  s += std::to_string(static_cast<int>(propId));
  s.push_back('\1');
  s.push_back('S');
  s += value;
  return h64Str(s);
}

inline uint64_t hashPropBool(uint8_t propId, bool value) {
  std::string s;
  s.push_back('\0');
  s.push_back('P');
  s += std::to_string(static_cast<int>(propId));
  s.push_back('\1');
  s.push_back('B');
  s.push_back(value ? '1' : '0');
  return h64Str(s);
}

inline constexpr uint8_t kElementNsCustom = 4;

inline uint64_t hashNs(uint8_t ns, const std::string& uri = std::string()) {
  if (ns == kElementNsCustom) {
    std::string s;
    s.push_back('\0');
    s.push_back('U');
    s += uri;
    return h64Str(s);
  }
  const uint8_t bytes[3] = {0x00, 0x53, ns};
  return h64Bytes(bytes, 3);
}

inline uint64_t hashShadowInit(uint8_t mode, uint8_t initFlags) {
  const uint8_t bytes[4] = {0x00, 0x48, mode, initFlags};
  return h64Bytes(bytes, 4);
}

// rowHash = H64(id, kind, parent, prevSibling, contentHash) — fold sensível a ordem.
inline uint64_t computeRowHash(uint32_t id, uint32_t kind, uint32_t parent,
                               uint32_t prevSibling, uint64_t contentHash) {
  uint64_t h = h64U32(id);
  h = h64U32(kind, h);
  h = h64U32(parent, h);
  h = h64U32(prevSibling, h);
  h ^= contentHash;
  h *= kFnvPrime;
  return h;
}

// tableHash = Σ rowHash (mod 2^64), mantido por subtrai-antigo/soma-novo.
// Recomputar em O(n) por frame é violação de contrato (§1.5), não escolha de otimização.
class TableHashTracker {
 public:
  uint64_t value() const { return total_; }
  size_t size() const { return rows_.size(); }
  bool has(uint32_t id) const { return rows_.find(id) != rows_.end(); }

  void upsert(uint32_t id, uint64_t rowHash) {
    auto it = rows_.find(id);
    if (it != rows_.end()) {
      total_ -= it->second;
      it->second = rowHash;
    } else {
      rows_.emplace(id, rowHash);
    }
    total_ += rowHash;
  }

  void remove(uint32_t id) {
    auto it = rows_.find(id);
    if (it == rows_.end()) return;
    total_ -= it->second;
    rows_.erase(it);
  }

  void clear() {
    total_ = 0;
    rows_.clear();
  }

 private:
  uint64_t total_ = 0;
  std::unordered_map<uint32_t, uint64_t> rows_;
};

}  // namespace speculum
