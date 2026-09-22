#pragma once

#include "domain/producer/NodeDescriptor.hpp"
#include "domain/producer/RowHash.hpp"
#include "domain/producer/Types.hpp"

namespace speculum::producer {

// Pure: same descriptors + mask ⇒ same RowChanges. No DOM, no motor, no lifecycle branch.
inline RowChanges emit(const NodeDescriptor* prev, const NodeDescriptor* curr,
                       const DirtyMask& mask) {
  RowChanges out;
  if (!prev && !curr) return out;

  if (!prev && curr) {
    RowChange c;
    c.op = RowOp::Create;
    c.id = curr->id();
    c.kind = curr->kind();
    c.ns = curr->ns();
    c.name = std::string(curr->name());
    c.parent = curr->parent();
    c.prevSibling = curr->prevSibling();
    c.contentHash = curr->contentHash();
    c.rowHash = curr->hash();
    out.push_back(std::move(c));
    return out;
  }

  if (prev && !curr) {
    RowChange c;
    c.op = RowOp::Remove;
    c.id = prev->id();
    out.push_back(std::move(c));
    return out;
  }

  RowChange c;
  c.op = RowOp::Diff;
  c.id = curr->id();
  c.kind = curr->kind();
  c.ns = curr->ns();
  c.name = mask.name ? std::string(curr->name()) : std::string(prev->name());
  c.parent = mask.topology ? curr->parent() : prev->parent();
  c.prevSibling = mask.topology ? curr->prevSibling() : prev->prevSibling();
  c.contentHash = curr->contentHash();
  c.rowHash = curr->hash();

  if (mask.allAttrs) {
    // Caller enumerates; purity tests use named attrs list.
  } else {
    for (const auto& an : mask.attrs) {
      AttrChange a;
      a.name = an;
      FieldHash h = curr->attr(an);
      FieldHash ph = prev->attr(an);
      if (h == 0 && ph != 0) {
        a.deleted = true;
      } else {
        a.hash = h;
      }
      c.attrs.push_back(std::move(a));
    }
  }
  out.push_back(std::move(c));
  return out;
}

}  // namespace speculum::producer
