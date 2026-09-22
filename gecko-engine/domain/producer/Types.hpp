#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum::producer {

using NodeId = uint32_t;  // 0 = none
using PropId = uint32_t;
using FieldHash = uint64_t;
using OpaqueRef = uint32_t;  // engine handle value; identity maps to NodeId

enum class KeySpace : uint8_t { Node = 0, Sheet = 1, Rule = 2 };

enum class DirtyKind : uint8_t {
  Attr = 1,
  Value = 2,
  Prop = 3,
  Topology = 4,  // parent / prevSibling
  Name = 5,
  Ns = 6,
};

enum class ChildChange : uint8_t { Inserted = 1, Removed = 2 };

// Bit mask of which descriptor fields emit should touch.
struct DirtyMask {
  bool topology{false};
  bool value{false};
  bool name{false};
  bool ns{false};
  bool allAttrs{false};
  std::vector<std::string> attrs;  // named attrs when !allAttrs
  std::vector<PropId> props;

  static DirtyMask full() {
    DirtyMask m;
    m.topology = true;
    m.value = true;
    m.name = true;
    m.ns = true;
    m.allAttrs = true;
    return m;
  }
  static DirtyMask create() { return full(); }
};

enum class RowOp : uint8_t {
  Create = 1,
  Diff = 2,
  Remove = 3,
  InsertBatch = 4,
  RemoveBatch = 5,
};

struct AttrChange {
  std::string name;
  std::string value;  // empty + deleted=true → del
  bool deleted{false};
  FieldHash hash{0};
};

struct RowChange {
  RowOp op{};
  NodeId id{0};
  NodeKind kind{NodeKind::Element};
  ElementNs ns{ElementNs::Html};
  std::string name;
  std::string value;
  NodeId parent{0};
  NodeId prevSibling{0};
  FieldHash contentHash{0};
  FieldHash rowHash{0};
  std::vector<AttrChange> attrs;
  // Batches:
  NodeId batchParent{0};
  NodeId before{0};
  std::vector<NodeId> batchIds;
};

using RowChanges = std::vector<RowChange>;

struct SnapshotHeader {
  uint64_t digest{0};
  uint32_t nodeCount{0};
};

}  // namespace speculum::producer
