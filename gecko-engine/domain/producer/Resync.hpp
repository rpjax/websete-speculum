#pragma once

#include <algorithm>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

#include "domain/Result.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/producer/Emit.hpp"
#include "domain/producer/Identity.hpp"
#include "domain/producer/LiveDescriptor.hpp"
#include "domain/producer/PatchBuilder.hpp"
#include "domain/producer/RowHash.hpp"
#include "domain/producer/Table.hpp"
#include "domain/producer/Types.hpp"
#include "ports/IDocumentView.hpp"

namespace speculum::producer {

enum class ResyncForce : uint8_t { FromMap = 0, FromWalk = 1 };

class Resync {
 public:
  // Never chooses force. Scope check: every live node under root must be in table after.
  static Result<void> run(ResyncForce force, const IDocumentView& view, Identity& identity,
                          ProducerTable& table, NodeRef root) {
    (void)force;  // both paths: emit(prev=nullptr) for every node — P8
    table.clear();
    if (!root.valid()) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchDocument, "Resync", "no root"));
    }
    walkCreate(view, identity, table, root, /*parent*/ 0, /*prev*/ 0);
    // Scope verification
    if (!view.root().valid() || !table.has(identity.lookup(root.value(), KeySpace::Node))) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::ResyncCheckFailed, "Resync", "scope"));
    }
    if (!table.checkInvariants()) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::ResyncCheckFailed, "Resync", "invariants"));
    }
    return Result<void>::success();
  }

 private:
  static void walkCreate(const IDocumentView& view, Identity& identity, ProducerTable& table,
                         NodeRef node, NodeId parent, NodeId prev) {
    LiveDescriptor live(view, identity, node);
    DirtyMask mask = DirtyMask::create();
    auto changes = emit(nullptr, &live, mask);
    // Enrich create with attrs from view
    if (!changes.empty() && changes[0].op == RowOp::Create) {
      changes[0].parent = parent;
      changes[0].prevSibling = prev;
      changes[0].value = std::string(view.characterData(node));
      uint32_t ac = view.attrCount(node);
      for (uint32_t i = 0; i < ac; ++i) {
        std::string_view an, av;
        view.attrAt(node, i, an, av);
        AttrChange a;
        a.name = std::string(an);
        a.value = std::string(av);
        a.hash = hashAttr(an, av);
        changes[0].attrs.push_back(std::move(a));
      }
    }
    table.apply(changes);
    NodeId id = live.id();
    NodeId childPrev = 0;
    uint32_t n = view.childCount(node);
    for (uint32_t i = 0; i < n; ++i) {
      auto c = view.childAt(node, i);
      walkCreate(view, identity, table, c, id, childPrev);
      childPrev = identity.lookup(c.value(), KeySpace::Node);
    }
    // Shadow roots are not light children — walk them or FromWalk diverges (Phase 8 A3).
    NodeRef sr = view.shadowRoot(node);
    if (sr.valid()) {
      walkCreate(view, identity, table, sr, id, /*prev*/ 0);
    }
  }
};

class Snapshot {
 public:
  static std::vector<uint8_t> capture(const ProducerTable& table) {
    std::vector<uint8_t> out;
    // Deterministic: sort by id
    std::vector<NodeId> ids;
    for (const auto& [id, r] : table.rows()) {
      (void)r;
      ids.push_back(id);
    }
    std::sort(ids.begin(), ids.end());
    putU32(out, uint32_t(ids.size()));
    for (auto id : ids) {
      const auto* r = table.find(id);
      putU32(out, r->id);
      putU8(out, uint8_t(r->kind));
      putU8(out, uint8_t(r->ns));
      putU32(out, r->parent);
      putU32(out, r->prevSibling);
      putU32(out, uint32_t(r->name.size()));
      out.insert(out.end(), r->name.begin(), r->name.end());
      // attrs sorted
      std::vector<std::string> keys;
      for (const auto& [k, v] : r->attrs) {
        (void)v;
        keys.push_back(k);
      }
      std::sort(keys.begin(), keys.end());
      putU16(out, uint16_t(keys.size()));
      for (const auto& k : keys) {
        putU16(out, uint16_t(k.size()));
        out.insert(out.end(), k.begin(), k.end());
        const auto& v = r->attrs.at(k);
        putU16(out, uint16_t(v.size()));
        out.insert(out.end(), v.begin(), v.end());
      }
    }
    return out;
  }

  static SnapshotHeader headerOf(const ProducerTable& table, std::span<const uint8_t> body) {
    SnapshotHeader h;
    h.nodeCount = uint32_t(table.size());
    h.digest = digestBytes(body);
    return h;
  }

 private:
  static void putU8(std::vector<uint8_t>& b, uint8_t v) { b.push_back(v); }
  static void putU16(std::vector<uint8_t>& b, uint16_t v) {
    b.push_back(uint8_t(v));
    b.push_back(uint8_t(v >> 8));
  }
  static void putU32(std::vector<uint8_t>& b, uint32_t v) {
    b.push_back(uint8_t(v));
    b.push_back(uint8_t(v >> 8));
    b.push_back(uint8_t(v >> 16));
    b.push_back(uint8_t(v >> 24));
  }
};

}  // namespace speculum::producer
