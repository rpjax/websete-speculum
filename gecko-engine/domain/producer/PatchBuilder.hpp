#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "domain/producer/RowHash.hpp"
#include "domain/producer/Types.hpp"

namespace speculum::producer {

// ISA opcodes — packages/page-projection/src/core/opcodes.ts
enum class IsaOp : uint8_t {
  Check = 0x01,
  NodeNew = 0x20,
  NodeDrop = 0x21,
  Insert = 0x40,
  Remove = 0x41,
  AttrSet = 0x60,
  AttrDel = 0x61,
  TextSet = 0x62,
  PropSet = 0x63,
};

inline void putU8(std::vector<uint8_t>& b, uint8_t v) { b.push_back(v); }
inline void putU16(std::vector<uint8_t>& b, uint16_t v) {
  b.push_back(uint8_t(v));
  b.push_back(uint8_t(v >> 8));
}
inline void putU32(std::vector<uint8_t>& b, uint32_t v) {
  b.push_back(uint8_t(v));
  b.push_back(uint8_t(v >> 8));
  b.push_back(uint8_t(v >> 16));
  b.push_back(uint8_t(v >> 24));
}
inline void putStr(std::vector<uint8_t>& b, std::string_view s) {
  putU16(b, uint16_t(s.size()));
  b.insert(b.end(), s.begin(), s.end());
}

class PatchBuilder {
 public:
  explicit PatchBuilder(std::vector<uint8_t>& scratch) : buf_(scratch) {}

  void begin() {
    buf_.clear();
    aborted_ = false;
    open_ = true;
  }

  void abort() {
    buf_.clear();
    aborted_ = true;
    open_ = false;
  }

  bool open() const { return open_; }
  bool aborted() const { return aborted_; }

  void nodeNew(NodeId id, NodeKind kind, ElementNs ns, std::string_view name) {
    if (!open_ || aborted_) return;
    putU8(buf_, uint8_t(IsaOp::NodeNew));
    putU32(buf_, id);
    putU8(buf_, uint8_t(kind));
    putU8(buf_, uint8_t(ns));
    putStr(buf_, name);
  }

  void nodeDrop(NodeId id) {
    if (!open_ || aborted_) return;
    putU8(buf_, uint8_t(IsaOp::NodeDrop));
    putU32(buf_, id);
  }

  void insert(NodeId parent, NodeId before, const std::vector<NodeId>& ids) {
    if (!open_ || aborted_) return;
    putU8(buf_, uint8_t(IsaOp::Insert));
    putU32(buf_, parent);
    putU32(buf_, before);
    putU16(buf_, uint16_t(ids.size()));
    for (auto id : ids) putU32(buf_, id);
  }

  void remove(NodeId parent, const std::vector<NodeId>& ids) {
    if (!open_ || aborted_) return;
    putU8(buf_, uint8_t(IsaOp::Remove));
    putU32(buf_, parent);
    putU16(buf_, uint16_t(ids.size()));
    for (auto id : ids) putU32(buf_, id);
  }

  void attrSet(NodeId id, std::string_view name, std::string_view value) {
    if (!open_ || aborted_) return;
    putU8(buf_, uint8_t(IsaOp::AttrSet));
    putU32(buf_, id);
    putStr(buf_, name);
    putStr(buf_, value);
  }

  void attrDel(NodeId id, std::string_view name) {
    if (!open_ || aborted_) return;
    putU8(buf_, uint8_t(IsaOp::AttrDel));
    putU32(buf_, id);
    putStr(buf_, name);
  }

  void textSet(NodeId id, std::string_view value) {
    if (!open_ || aborted_) return;
    putU8(buf_, uint8_t(IsaOp::TextSet));
    putU32(buf_, id);
    putStr(buf_, value);
  }

  // Closes and returns span into scratch. Must publish same turn.
  std::span<const uint8_t> end() {
    open_ = false;
    if (aborted_) return {};
    return std::span<const uint8_t>(buf_.data(), buf_.size());
  }

  // Count opcodes of a given type in buffer (for tests).
  static int countOp(std::span<const uint8_t> p, IsaOp op) {
    // Naive scan: only works for our simple encoding without nested structures.
    int n = 0;
    size_t i = 0;
    while (i < p.size()) {
      auto code = IsaOp(p[i++]);
      if (code == op) ++n;
      switch (code) {
        case IsaOp::NodeNew: {
          if (i + 6 > p.size()) return n;
          i += 4 + 1 + 1;
          if (i + 2 > p.size()) return n;
          uint16_t len = uint16_t(p[i]) | (uint16_t(p[i + 1]) << 8);
          i += 2 + len;
          break;
        }
        case IsaOp::NodeDrop:
          i += 4;
          break;
        case IsaOp::Insert: {
          i += 4 + 4;
          if (i + 2 > p.size()) return n;
          uint16_t c = uint16_t(p[i]) | (uint16_t(p[i + 1]) << 8);
          i += 2 + c * 4;
          break;
        }
        case IsaOp::Remove: {
          i += 4;
          if (i + 2 > p.size()) return n;
          uint16_t c = uint16_t(p[i]) | (uint16_t(p[i + 1]) << 8);
          i += 2 + c * 4;
          break;
        }
        case IsaOp::AttrSet: {
          i += 4;
          auto skipStr = [&] {
            uint16_t len = uint16_t(p[i]) | (uint16_t(p[i + 1]) << 8);
            i += 2 + len;
          };
          skipStr();
          skipStr();
          break;
        }
        case IsaOp::AttrDel:
        case IsaOp::TextSet: {
          i += 4;
          uint16_t len = uint16_t(p[i]) | (uint16_t(p[i + 1]) << 8);
          i += 2 + len;
          if (code == IsaOp::TextSet) {
            // already skipped one str after id — TextSet is id+str only
          }
          break;
        }
        default:
          return n;
      }
    }
    return n;
  }

 private:
  std::vector<uint8_t>& buf_;
  bool open_{false};
  bool aborted_{false};
};

class PatchSequence {
 public:
  uint32_t next() { return ++seq_; }
  uint32_t current() const { return seq_; }
  void reset() { seq_ = 0; }

 private:
  uint32_t seq_{0};
};

// Order-dependent 64-bit digest of patch bytes (stable C++/TS).
inline uint64_t digestBytes(std::span<const uint8_t> bytes) {
  return h64Bytes(bytes.data(), bytes.size());
}

inline uint64_t digestTable(uint64_t tableHash, uint32_t sequence) {
  uint64_t h = h64U32(sequence);
  h ^= tableHash;
  h = (h * kFnvPrime) & kMask64;
  return h;
}

}  // namespace speculum::producer
