// Speculum — modelo de op + escritor binário + montagem de parte de frame.
// Port de virtual/frame/binaryWriter.ts e binaryFrameEncoder.ts. Layout tem que casar
// byte a byte com core/decode.ts — é isso que o teste de round-trip prova.
#pragma once
#include <cstdint>
#include "speculum/Fatal.h"

#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace speculum {

// ---- ISA (core/opcodes.ts) — valores estáveis no fio, nunca renumerar. ----
enum class Op : uint8_t {
  Check = 0x01,
  NodeNew = 0x20,
  NodeDrop = 0x21,
  Insert = 0x40,
  Remove = 0x41,
  AttrSet = 0x60,
  AttrDel = 0x61,
  TextSet = 0x62,
  PropSet = 0x63,
  SheetNew = 0xa0,
  SheetDrop = 0xa1,
  SheetOrder = 0xa2,
  RuleNew = 0xa3,
  RuleDrop = 0xa4,
  RuleSet = 0xa5,
};

enum class NodeKind : uint8_t {
  Element = 1,
  Text = 2,
  Comment = 3,
  Sheet = 4,
  Rule = 5,
  Doctype = 6,
  ShadowRoot = 7,
};

enum class ElementNs : uint8_t { Html = 0, Svg = 1, Mathml = 2, None = 3, Custom = 4 };

inline constexpr uint16_t kWireMagic = 0x5050;  // 'PP'
inline constexpr uint8_t kWireVersion = 2;
inline constexpr size_t kFramePrefixBytes = 2 + 1 + 1 + 4 + 4 + 4 + 2 + 2 + 8;
inline constexpr uint32_t kDocumentId = 1;
inline constexpr uint32_t kContextIdRoot = 1;
inline constexpr uint32_t kInsertAtEnd = 0;
inline constexpr uint32_t kLocalStrBit = 0x80000000u;
inline constexpr uint8_t kCheckScopeTable = 0;
inline constexpr uint8_t kCheckScopeRange = 1;
inline constexpr uint8_t kElementNsNestedHostBit = 0x80;
inline constexpr uint8_t kFrameFlagResync = 0b10;

struct AttrPair {
  std::string name;
  std::string value;
};

// Escritor little-endian com tabela de strings por parte.
class BinaryWriter {
 public:
  explicit BinaryWriter(size_t initialCapacity = 4096) { buf_.reserve(initialCapacity); }

  size_t length() const { return buf_.size(); }

  void reset() {
    buf_.clear();
    strings_.clear();
    stringIndex_.clear();
  }

  void u8(uint8_t v) { buf_.push_back(v); }

  void u16(uint16_t v) {
    buf_.push_back(static_cast<uint8_t>(v & 0xff));
    buf_.push_back(static_cast<uint8_t>((v >> 8) & 0xff));
  }

  void u32(uint32_t v) {
    for (int i = 0; i < 4; ++i) buf_.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
  }

  void u64(uint64_t v) {
    for (int i = 0; i < 8; ++i) buf_.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
  }

  void f32(float v) {
    uint32_t bits;
    std::memcpy(&bits, &v, 4);
    u32(bits);
  }

  // Interna a string; devolve o índice na tabela desta parte.
  uint32_t str(const std::string& value) {
    auto it = stringIndex_.find(value);
    if (it != stringIndex_.end()) return it->second;
    uint32_t idx = static_cast<uint32_t>(strings_.size());
    strings_.push_back(value);
    stringIndex_.emplace(value, idx);
    return idx;
  }

  void strRef(const std::string& value) { u32(str(value) | kLocalStrBit); }

  const std::vector<uint8_t>& bytes() const { return buf_; }
  const std::vector<std::string>& strings() const { return strings_; }

  std::vector<uint8_t> takeStringTableBytes() const {
    std::vector<uint8_t> out;
    auto pushU32 = [&out](uint32_t v) {
      for (int i = 0; i < 4; ++i) out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
    };
    pushU32(static_cast<uint32_t>(strings_.size()));
    for (const auto& s : strings_) {
      pushU32(static_cast<uint32_t>(s.size()));
      out.insert(out.end(), s.begin(), s.end());
    }
    return out;
  }

 private:
  std::vector<uint8_t> buf_;
  std::vector<std::string> strings_;
  std::map<std::string, uint32_t> stringIndex_;
};

struct PartHeader {
  uint8_t version = kWireVersion;
  uint8_t flags = 0;
  uint32_t contextId = kContextIdRoot;
  uint32_t generation = 0;
  uint32_t sequence = 0;
  uint16_t partIndex = 0;
  uint16_t partCount = 1;
  uint64_t preTableHash = 0;
};

inline std::vector<uint8_t> assemblePart(const PartHeader& h,
                                         const std::vector<uint8_t>& stringTable,
                                         const std::vector<uint8_t>& opsBody) {
  std::vector<uint8_t> out;
  out.reserve(kFramePrefixBytes + stringTable.size() + opsBody.size());
  auto pushU16 = [&out](uint16_t v) {
    out.push_back(static_cast<uint8_t>(v & 0xff));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xff));
  };
  auto pushU32 = [&out](uint32_t v) {
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
  };
  auto pushU64 = [&out](uint64_t v) {
    for (int i = 0; i < 8; ++i) out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
  };
  pushU16(kWireMagic);
  out.push_back(h.version);
  out.push_back(h.flags);
  pushU32(h.contextId);
  pushU32(h.generation);
  pushU32(h.sequence);
  pushU16(h.partIndex);
  pushU16(h.partCount);
  pushU64(h.preTableHash);
  out.insert(out.end(), stringTable.begin(), stringTable.end());
  out.insert(out.end(), opsBody.begin(), opsBody.end());
  return out;
}

// Acumula ops numa parte. Uma instância por frame; `finish` monta os bytes.
class FramePartBuilder {
 public:
  void begin() {
    w_.reset();
    opCount_ = 0;
  }

  // ---- §4.1 CHECK: scope u8, lo u32, hi u32, hash u64 ----
  void check(uint8_t scope, uint32_t lo, uint32_t hi, uint64_t hash) {
    op(Op::Check);
    w_.u8(scope);
    w_.u32(lo);
    w_.u32(hi);
    w_.u64(hash);
  }

  // ---- §4.2 NODE_NEW ----
  void nodeNewElement(uint32_t id, ElementNs ns, const std::string& name,
                      const std::vector<AttrPair>& attrs, const std::string& customUri = "",
                      bool nestedHost = false, uint32_t childScopeId = 0) {
    if (ns == ElementNs::Custom && customUri.empty()) {
      SPECULUM_FATAL("NODE_NEW custom ns exige uri (frame-protocol.md 4.2)");
    }
    if (nestedHost && childScopeId < 2) {
      SPECULUM_FATAL("NODE_NEW childScopeId nao e contexto aninhado (4.2)");
    }
    op(Op::NodeNew);
    w_.u32(id);
    w_.u8(static_cast<uint8_t>(NodeKind::Element));
    w_.u8(static_cast<uint8_t>((nestedHost ? kElementNsNestedHostBit : 0) |
                               static_cast<uint8_t>(ns)));
    if (ns == ElementNs::Custom) w_.strRef(customUri);
    w_.strRef(name);
    writeAttrs(attrs);
    if (nestedHost) w_.u32(childScopeId);
  }

  void nodeNewText(uint32_t id, const std::string& value) {
    nodeNewValue(id, NodeKind::Text, value);
  }

  void nodeNewComment(uint32_t id, const std::string& value) {
    nodeNewValue(id, NodeKind::Comment, value);
  }

  void nodeNewDoctype(uint32_t id, const std::string& name) {
    op(Op::NodeNew);
    w_.u32(id);
    w_.u8(static_cast<uint8_t>(NodeKind::Doctype));
    w_.strRef(name);
  }

  void nodeNewShadowRoot(uint32_t id, uint32_t host, uint8_t mode, uint8_t initFlags) {
    op(Op::NodeNew);
    w_.u32(id);
    w_.u8(static_cast<uint8_t>(NodeKind::ShadowRoot));
    w_.u32(host);
    w_.u8(mode);
    w_.u8(initFlags);
  }

  // ---- §4.2 NODE_DROP: só raízes; descendentes são derivados dos dois lados ----
  void nodeDrop(const std::vector<uint32_t>& ids) {
    op(Op::NodeDrop);
    w_.u16(static_cast<uint16_t>(ids.size()));
    for (uint32_t id : ids) w_.u32(id);
  }

  // ---- §4.3 topologia ----
  void insert(uint32_t parent, uint32_t before, const std::vector<uint32_t>& ids) {
    op(Op::Insert);
    w_.u32(parent);
    w_.u32(before);
    w_.u16(static_cast<uint16_t>(ids.size()));
    for (uint32_t id : ids) w_.u32(id);
  }

  void remove(uint32_t parent, const std::vector<uint32_t>& ids) {
    op(Op::Remove);
    w_.u32(parent);
    w_.u16(static_cast<uint16_t>(ids.size()));
    for (uint32_t id : ids) w_.u32(id);
  }

  // ---- §4.4 conteúdo ----
  void attrSet(uint32_t node, const std::vector<AttrPair>& attrs) {
    op(Op::AttrSet);
    w_.u32(node);
    writeAttrs(attrs);
  }

  void attrDel(uint32_t node, const std::vector<std::string>& names) {
    op(Op::AttrDel);
    w_.u32(node);
    w_.u16(static_cast<uint16_t>(names.size()));
    for (const auto& n : names) w_.strRef(n);
  }

  void textSet(uint32_t node, const std::string& value) {
    op(Op::TextSet);
    w_.u32(node);
    w_.strRef(value);
  }

  void propSetStr(uint32_t node, uint8_t propId, const std::string& value) {
    op(Op::PropSet);
    w_.u32(node);
    w_.u8(propId);
    w_.strRef(value);
  }

  void propSetBool(uint32_t node, uint8_t propId, bool value) {
    op(Op::PropSet);
    w_.u32(node);
    w_.u8(propId);
    w_.u8(value ? 1 : 0);
  }

  uint32_t opCount() const { return opCount_; }

  // Monta a parte. O corpo de ops é precedido por opCount (§2).
  std::vector<uint8_t> finish(const PartHeader& header) const {
    std::vector<uint8_t> opsBody;
    opsBody.reserve(4 + w_.bytes().size());
    for (int i = 0; i < 4; ++i) opsBody.push_back(static_cast<uint8_t>((opCount_ >> (8 * i)) & 0xff));
    const auto& b = w_.bytes();
    opsBody.insert(opsBody.end(), b.begin(), b.end());
    return assemblePart(header, w_.takeStringTableBytes(), opsBody);
  }

 private:
  void op(Op code) {
    w_.u8(static_cast<uint8_t>(code));
    ++opCount_;
  }

  void nodeNewValue(uint32_t id, NodeKind kind, const std::string& value) {
    op(Op::NodeNew);
    w_.u32(id);
    w_.u8(static_cast<uint8_t>(kind));
    w_.strRef(value);
  }

  void writeAttrs(const std::vector<AttrPair>& attrs) {
    w_.u16(static_cast<uint16_t>(attrs.size()));
    for (const auto& a : attrs) {
      w_.strRef(a.name);
      w_.strRef(a.value);
    }
  }

  BinaryWriter w_;
  uint32_t opCount_ = 0;
};

}  // namespace speculum
