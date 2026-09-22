#pragma once

#include <string>
#include <unordered_map>

#include "domain/producer/NodeDescriptor.hpp"
#include "domain/producer/RowHash.hpp"

namespace speculum::producer {

// Test-only concrete descriptor (product path uses Live/Row views).
struct MemDescriptor final : NodeDescriptor {
  NodeId id_{0};
  NodeKind kind_{NodeKind::Element};
  ElementNs ns_{ElementNs::Html};
  std::string name_;
  std::string value_;
  NodeId parent_{0};
  NodeId prev_{0};
  std::unordered_map<std::string, std::string> attrs_;

  NodeId id() const override { return id_; }
  NodeKind kind() const override { return kind_; }
  ElementNs ns() const override { return ns_; }
  std::string_view name() const override { return name_; }
  FieldHash value() const override { return hashValue(value_); }
  FieldHash attr(std::string_view n) const override {
    auto it = attrs_.find(std::string(n));
    if (it == attrs_.end()) return 0;
    return hashAttr(it->first, it->second);
  }
  FieldHash prop(PropId) const override { return 0; }
  NodeId parent() const override { return parent_; }
  NodeId prevSibling() const override { return prev_; }
  FieldHash contentHash() const override {
    FieldHash ch = 0;
    ch = addMod64(ch, hashNs(static_cast<uint8_t>(ns_)));
    ch = addMod64(ch, hashName(name_));
    ch = addMod64(ch, hashValue(value_));
    for (const auto& [k, v] : attrs_) ch = addMod64(ch, hashAttr(k, v));
    return ch;
  }
  uint64_t hash() const override {
    return computeRowHash(id_, static_cast<uint32_t>(kind_), parent_, prev_, contentHash());
  }
};

}  // namespace speculum::producer
