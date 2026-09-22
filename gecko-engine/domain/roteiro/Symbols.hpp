#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>

namespace speculum::roteiro {

enum class SymKind : uint8_t {
  Process = 0,  // p
  Viewport,     // v
  Frame,        // f  (= HostId slot)
  Document,     // d
  Node,         // n
  Sheet,        // s
  Rule,         // r
  Timer,        // t
  Stream,       // x
};

inline char symPrefix(SymKind k) {
  switch (k) {
    case SymKind::Process: return 'p';
    case SymKind::Viewport: return 'v';
    case SymKind::Frame: return 'f';
    case SymKind::Document: return 'd';
    case SymKind::Node: return 'n';
    case SymKind::Sheet: return 's';
    case SymKind::Rule: return 'r';
    case SymKind::Timer: return 't';
    case SymKind::Stream: return 'x';
  }
  return '?';
}

// Sequential symbols — never pointers. Same appearance order ⇒ identical names.
class SymbolTable {
 public:
  std::string intern(SymKind kind, uint64_t opaqueKey) {
    auto key = pack(kind, opaqueKey);
    auto it = by_key_.find(key);
    if (it != by_key_.end()) return it->second;
    uint32_t n = ++seq_[static_cast<int>(kind)];
    std::string sym = std::string(1, symPrefix(kind)) + std::to_string(n);
    by_key_[key] = sym;
    by_sym_[sym] = opaqueKey;
    return sym;
  }

  // Mint next without opaque (appearance order only).
  std::string mint(SymKind kind) {
    uint32_t n = ++seq_[static_cast<int>(kind)];
    std::string sym = std::string(1, symPrefix(kind)) + std::to_string(n);
    by_sym_[sym] = n;
    by_key_[pack(kind, n)] = sym;
    return sym;
  }

  bool lookup(const std::string& sym, uint64_t& out) const {
    auto it = by_sym_.find(sym);
    if (it == by_sym_.end()) return false;
    out = it->second;
    return true;
  }

  bool hasPointerLike(std::string_view line) const {
    // Heuristic for §6: no 0x hex addresses in observable lines.
    return line.find("0x") != std::string_view::npos;
  }

  void reset() {
    by_key_.clear();
    by_sym_.clear();
    for (auto& s : seq_) s = 0;
  }

 private:
  static uint64_t pack(SymKind k, uint64_t id) {
    return (uint64_t(static_cast<uint8_t>(k)) << 56) | (id & 0x00ffffffffffffffull);
  }

  std::unordered_map<uint64_t, std::string> by_key_;
  std::unordered_map<std::string, uint64_t> by_sym_;
  uint32_t seq_[9]{};
};

}  // namespace speculum::roteiro
