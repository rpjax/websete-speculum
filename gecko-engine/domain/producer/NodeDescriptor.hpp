#pragma once

#include <cstdint>
#include <string_view>

#include "domain/Types.hpp"
#include "domain/producer/Types.hpp"

namespace speculum::producer {

// Lazy view — never a materialized struct of all fields.
struct NodeDescriptor {
  virtual ~NodeDescriptor() = default;
  virtual NodeKind kind() const = 0;
  virtual ElementNs ns() const = 0;
  virtual std::string_view name() const = 0;
  virtual FieldHash value() const = 0;
  virtual FieldHash attr(std::string_view name) const = 0;
  virtual FieldHash prop(PropId) const = 0;
  virtual NodeId parent() const = 0;
  virtual NodeId prevSibling() const = 0;
  virtual NodeId id() const = 0;
  virtual uint64_t hash() const = 0;  // == rowHash; O(fields)
  virtual FieldHash contentHash() const = 0;
};

}  // namespace speculum::producer
