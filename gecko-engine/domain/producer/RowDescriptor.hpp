#pragma once

#include <string>

#include "domain/producer/NodeDescriptor.hpp"
#include "domain/producer/RowHash.hpp"
#include "domain/producer/Table.hpp"

namespace speculum::producer {

class RowDescriptor final : public NodeDescriptor {
 public:
  explicit RowDescriptor(const TableRow* row) : row_(row) {}

  NodeId id() const override { return row_ ? row_->id : 0; }
  NodeKind kind() const override { return row_ ? row_->kind : NodeKind::Element; }
  ElementNs ns() const override { return row_ ? row_->ns : ElementNs::Html; }
  std::string_view name() const override {
    return row_ ? std::string_view(row_->name) : std::string_view{};
  }
  FieldHash value() const override {
    return row_ ? hashValue(row_->value) : 0;
  }
  FieldHash attr(std::string_view name) const override {
    if (!row_) return 0;
    auto it = row_->attrs.find(std::string(name));
    if (it == row_->attrs.end()) return 0;
    return hashAttr(it->first, it->second);
  }
  FieldHash prop(PropId) const override { return 0; }
  NodeId parent() const override { return row_ ? row_->parent : 0; }
  NodeId prevSibling() const override { return row_ ? row_->prevSibling : 0; }
  FieldHash contentHash() const override { return row_ ? row_->contentHash : 0; }
  uint64_t hash() const override { return row_ ? row_->rowHash : 0; }

 private:
  const TableRow* row_;
};

}  // namespace speculum::producer
