#pragma once

#include <cassert>
#include <string>
#include <unordered_map>

#include "domain/Types.hpp"
#include "domain/producer/RowHash.hpp"
#include "domain/producer/Types.hpp"

namespace speculum::producer {

struct TableRow {
  NodeId id{0};
  NodeKind kind{NodeKind::Element};
  ElementNs ns{ElementNs::Html};
  std::string name;
  std::string value;
  NodeId parent{0};
  NodeId prevSibling{0};
  NodeId nextSibling{0};
  std::unordered_map<std::string, std::string> attrs;
  std::unordered_map<std::string, FieldHash> fieldHash;
  FieldHash contentHash{0};
  FieldHash rowHash{0};
};

class ProducerTable {
 public:
  bool has(NodeId id) const { return rows_.count(id) != 0; }
  TableRow* find(NodeId id) {
    auto it = rows_.find(id);
    return it == rows_.end() ? nullptr : &it->second;
  }
  const TableRow* find(NodeId id) const {
    auto it = rows_.find(id);
    return it == rows_.end() ? nullptr : &it->second;
  }

  NodeId lastChildOf(NodeId parent) const {
    auto it = last_child_.find(parent);
    return it == last_child_.end() ? 0 : it->second;
  }

  NodeId firstChildOf(NodeId parent) const {
    auto it = first_child_.find(parent);
    return it == first_child_.end() ? 0 : it->second;
  }

  NodeId nextSiblingOf(NodeId id) const {
    const auto* r = find(id);
    return r ? r->nextSibling : 0;
  }

  void clear() {
    rows_.clear();
    last_child_.clear();
    first_child_.clear();
    table_hash_ = 0;
  }

  void reserve(size_t n) {
    rows_.reserve(n);
    last_child_.reserve(n);
    first_child_.reserve(n);
  }

  uint64_t tableHash() const { return table_hash_; }
  size_t size() const { return rows_.size(); }

  const std::unordered_map<NodeId, TableRow>& rows() const { return rows_; }

  void upsertRow(TableRow row) {
    if (has(row.id)) {
      table_hash_ = subMod64(table_hash_, rows_[row.id].rowHash);
      unlink(rows_[row.id]);
    }
    recomputeContent(row);
    row.rowHash = computeRowHash(row.id, static_cast<uint32_t>(row.kind), row.parent,
                                 row.prevSibling, row.contentHash);
    linkIn(row);
    table_hash_ = addMod64(table_hash_, row.rowHash);
    rows_[row.id] = std::move(row);
  }

  void removeRow(NodeId id) {
    auto* r = find(id);
    if (!r) return;
    table_hash_ = subMod64(table_hash_, r->rowHash);
    unlink(*r);
    rows_.erase(id);
  }

  void apply(const RowChanges& changes) {
    for (const auto& c : changes) {
      switch (c.op) {
        case RowOp::Create: {
          TableRow row;
          row.id = c.id;
          row.kind = c.kind;
          row.ns = c.ns;
          row.name = c.name;
          row.value = c.value;
          row.parent = c.parent;
          row.prevSibling = c.prevSibling;
          row.fieldHash["name"] = hashName(c.name);
          row.fieldHash["ns"] = hashNs(static_cast<uint8_t>(c.ns));
          row.fieldHash["value"] = hashValue(c.value);
          for (const auto& a : c.attrs) {
            if (!a.deleted) {
              row.attrs[a.name] = a.value;
              row.fieldHash["a:" + a.name] = a.hash ? a.hash : hashAttr(a.name, a.value);
            }
          }
          upsertRow(std::move(row));
          break;
        }
        case RowOp::Remove:
          removeRow(c.id);
          break;
        case RowOp::Diff: {
          auto* r = find(c.id);
          assert(r);
          TableRow row = *r;
          row.kind = c.kind;
          row.ns = c.ns;
          if (!c.name.empty()) {
            row.name = c.name;
            row.fieldHash["name"] = hashName(c.name);
          }
          row.value = c.value;
          row.fieldHash["value"] = hashValue(c.value);
          row.parent = c.parent;
          row.prevSibling = c.prevSibling;
          for (const auto& a : c.attrs) {
            if (a.deleted) {
              row.attrs.erase(a.name);
              row.fieldHash.erase("a:" + a.name);
            } else {
              row.attrs[a.name] = a.value;
              row.fieldHash["a:" + a.name] = a.hash ? a.hash : hashAttr(a.name, a.value);
            }
          }
          upsertRow(std::move(row));
          break;
        }
        case RowOp::InsertBatch:
          break;
        case RowOp::RemoveBatch:
          for (auto id : c.batchIds) removeRow(id);
          break;
      }
    }
  }

  bool fieldMatches(NodeId id, const std::string& field, FieldHash live) const {
    const auto* r = find(id);
    if (!r) return false;
    auto it = r->fieldHash.find(field);
    if (it == r->fieldHash.end()) return live == 0;
    return it->second == live;
  }

  bool checkInvariants() const {
    for (const auto& [id, r] : rows_) {
      (void)id;
      if (r.prevSibling != 0) {
        const auto* prev = find(r.prevSibling);
        if (!prev || prev->parent != r.parent || prev->nextSibling != r.id) return false;
      }
      if (r.nextSibling != 0) {
        const auto* next = find(r.nextSibling);
        if (!next || next->parent != r.parent || next->prevSibling != r.id) return false;
      }
      if (r.parent != 0 && r.nextSibling == 0) {
        auto it = last_child_.find(r.parent);
        if (it == last_child_.end() || it->second != r.id) return false;
      }
      if (r.parent != 0 && r.prevSibling == 0) {
        auto it = first_child_.find(r.parent);
        if (it == first_child_.end() || it->second != r.id) return false;
      }
      auto expected = computeRowHash(r.id, static_cast<uint32_t>(r.kind), r.parent,
                                     r.prevSibling, r.contentHash);
      if (expected != r.rowHash) return false;
    }
    return true;
  }

 private:
  void recomputeContent(TableRow& r) {
    FieldHash ch = 0;
    ch = addMod64(ch, hashNs(static_cast<uint8_t>(r.ns)));
    ch = addMod64(ch, hashName(r.name));
    ch = addMod64(ch, hashValue(r.value));
    for (const auto& [n, v] : r.attrs) ch = addMod64(ch, hashAttr(n, v));
    r.contentHash = ch;
  }

  void rehash(TableRow& r) {
    table_hash_ = subMod64(table_hash_, r.rowHash);
    r.rowHash = computeRowHash(r.id, static_cast<uint32_t>(r.kind), r.parent,
                               r.prevSibling, r.contentHash);
    table_hash_ = addMod64(table_hash_, r.rowHash);
  }

  void unlink(TableRow& r) {
    if (r.prevSibling) {
      if (auto* prev = find(r.prevSibling)) {
        prev->nextSibling = r.nextSibling;
      }
    }
    if (r.nextSibling) {
      if (auto* next = find(r.nextSibling)) {
        next->prevSibling = r.prevSibling;
        rehash(*next);  // prevSibling changed — part of rowHash
      }
    }
    if (r.parent && last_child_[r.parent] == r.id) {
      if (r.prevSibling)
        last_child_[r.parent] = r.prevSibling;
      else
        last_child_.erase(r.parent);
    }
    if (r.parent && first_child_[r.parent] == r.id) {
      if (r.nextSibling)
        first_child_[r.parent] = r.nextSibling;
      else
        first_child_.erase(r.parent);
    }
    r.nextSibling = 0;
  }

  void linkIn(TableRow& r) {
    r.nextSibling = 0;
    if (r.prevSibling) {
      auto* prev = find(r.prevSibling);
      if (!prev || prev->parent != r.parent) {
        r.prevSibling = 0;
      } else {
        r.nextSibling = prev->nextSibling;
        prev->nextSibling = r.id;
        if (r.nextSibling) {
          if (auto* next = find(r.nextSibling)) {
            next->prevSibling = r.id;
            rehash(*next);
          }
        }
      }
    }
    if (!r.prevSibling && r.parent) {
      // O(1) via first_child_ — never scan the whole table.
      NodeId oldFirst = firstChildOf(r.parent);
      r.nextSibling = oldFirst;
      if (oldFirst) {
        if (auto* next = find(oldFirst)) {
          next->prevSibling = r.id;
          rehash(*next);
        }
      }
      first_child_[r.parent] = r.id;
    }
    if (r.parent && r.nextSibling == 0) last_child_[r.parent] = r.id;
    if (r.parent && r.prevSibling == 0) first_child_[r.parent] = r.id;
  }

  std::unordered_map<NodeId, TableRow> rows_;
  std::unordered_map<NodeId, NodeId> last_child_;
  std::unordered_map<NodeId, NodeId> first_child_;
  uint64_t table_hash_{0};
};

}  // namespace speculum::producer
