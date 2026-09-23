#pragma once

#include <cassert>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "domain/ids/Ids.hpp"
#include "domain/producer/DirtyLedger.hpp"
#include "domain/producer/Emit.hpp"
#include "domain/producer/Identity.hpp"
#include "domain/producer/LiveDescriptor.hpp"
#include "domain/producer/PatchBuilder.hpp"
#include "domain/producer/PatchClock.hpp"
#include "domain/producer/Resync.hpp"
#include "domain/producer/RowDescriptor.hpp"
#include "domain/producer/RowHash.hpp"
#include "domain/producer/Table.hpp"
#include "domain/producer/Types.hpp"
#include "ports/IClock.hpp"
#include "ports/IDocumentObserver.hpp"
#include "ports/IDocumentView.hpp"
#include "ports/IPatchUplink.hpp"

namespace speculum::producer {

// One per document. Ports: IDocumentView, IClock, IPatchUplink, self as IDocumentObserver.
class Producer final : public IDocumentObserver {
 public:
  Producer(DocumentId doc, const IDocumentView& view, IClock& clock, IPatchUplink& uplink,
           Millis tick = 16)
      : doc_(doc),
        view_(view),
        uplink_(uplink),
        clock_(clock, uplink, tick, &Producer::staticFlush, this) {}

  Identity& identity() { return identity_; }
  ProducerTable& table() { return table_; }
  DirtyLedger& ledger() { return ledger_; }
  PatchClock& patchClock() { return clock_; }
  PatchSequence& sequence() { return sequence_; }
  DocumentId documentId() const { return doc_; }
  const IDocumentView& view() const { return view_; }
  bool hasSheet(SheetRef s) const { return known_sheets_.count(s.value()) != 0; }
  size_t knownSheetCount() const { return known_sheets_.size(); }

  // oracle.postcondition — launch toggle; off by default.
  void enablePostcondition(bool v) { postcondition_ = v; }
  bool postconditionEnabled() const { return postcondition_; }

  // Cold start / resync — same emit(prev=nullptr) path.
  Result<void> establish(NodeRef root) {
    auto r = Resync::run(ResyncForce::FromWalk, view_, identity_, table_, root);
    if (!r.ok()) return r;
    ledger_.discardPending();
    publishColdFromTable();
    return Result<void>::success();
  }

  void flush() {
    // Go through the clock so dirty is cleared (same as timer path).
    clock_.onDirty();
    clock_.flushNow();
  }

  void publishColdFromTable() {
    scratch_.clear();
    PatchBuilder b(scratch_);
    b.begin();
    // NodeNew for every row (cold = prev nullptr), then Insert under parents.
    std::vector<NodeId> ids;
    for (const auto& [id, row] : table_.rows()) {
      (void)row;
      ids.push_back(id);
    }
    std::sort(ids.begin(), ids.end());
    for (auto id : ids) {
      const auto* row = table_.find(id);
      b.nodeNew(id, row->kind, row->ns, row->name);
      for (const auto& [n, v] : row->attrs) b.attrSet(id, n, v);
    }
    // Insert children grouped by parent in sibling order
    std::unordered_map<NodeId, std::vector<NodeId>> byParent;
    for (auto id : ids) {
      const auto* row = table_.find(id);
      if (row->parent) byParent[row->parent].push_back(id);
    }
    for (auto& [parent, children] : byParent) {
      std::sort(children.begin(), children.end(), [&](NodeId a, NodeId b) {
        // order by walking prevSibling chain — place roots (prev==0) first
        const auto* ra = table_.find(a);
        const auto* rb = table_.find(b);
        if (ra->prevSibling == 0) return true;
        if (rb->prevSibling == 0) return false;
        return a < b;
      });
      // Rebuild sibling order
      std::vector<NodeId> ordered;
      NodeId cur = 0;
      for (auto id : children) {
        const auto* r = table_.find(id);
        if (r->prevSibling == 0) {
          cur = id;
          break;
        }
      }
      while (cur) {
        ordered.push_back(cur);
        cur = table_.nextSiblingOf(cur);
      }
      if (!ordered.empty()) b.insert(parent, 0, ordered);
    }
    auto span = b.end();
    if (span.empty()) return;
    uplink_.publish(doc_, sequence_.next(), span);
  }

  // --- IDocumentObserver: mark only ---
  void onReady() override {}
  void onRoot(NodeRef root) override {
    identity_.assign(root.value(), KeySpace::Node);
    clock_.onDirty();
  }
  void onChildList(NodeRef parent, uint32_t index, uint32_t remove,
                   const NodeRef* add, uint32_t addCount) override {
    OpaqueRef ph = parent.value();
    // Removals first — child still present at index when notified.
    for (uint32_t i = 0; i < remove && parent.valid(); ++i) {
      NodeRef ch = view_.childAt(parent, index + i);
      if (!ch.valid()) continue;
      ledger_.markChild(ph, ch.value(), ChildChange::Removed, 0);
    }
    OpaqueRef prev = 0;
    if (addCount > 0 && parent.valid()) {
      uint32_t n = view_.childCount(parent);
      for (uint32_t i = 0; i < n; ++i) {
        if (view_.childAt(parent, i) == add[0]) {
          if (i > 0) prev = view_.childAt(parent, i - 1).value();
          break;
        }
      }
    }
    for (uint32_t i = 0; i < addCount; ++i) {
      OpaqueRef ch = add[i].value();
      identity_.assign(ch, KeySpace::Node);
      ledger_.markChild(ph, ch, ChildChange::Inserted, prev);
      prev = ch;
    }
    clock_.onDirty();
  }
  void onCharacterData(NodeRef node, std::string_view) override {
    ledger_.markField(node.value(), DirtyKind::Value, "value");
    clock_.onDirty();
  }
  void onAttr(NodeRef el, std::string_view name, std::string_view) override {
    ledger_.markField(el.value(), DirtyKind::Attr, name);
    clock_.onDirty();
  }
  void onAttrRemoved(NodeRef el, std::string_view name) override {
    ledger_.markField(el.value(), DirtyKind::Attr, name);
    clock_.onDirty();
  }
  void onShadow(NodeRef host, ShadowMode, NodeRef root) override {
    if (!root.valid()) return;
    identity_.assign(root.value(), KeySpace::Node);
    ledger_.markChild(host.value(), root.value(), ChildChange::Inserted, 0);
    clock_.onDirty();
  }
  void onCustomElement(NodeRef, std::string_view) override {}
  void onSheetAdded(SheetRef sheet, uint32_t) override {
    identity_.assign(sheet.value(), KeySpace::Sheet);
    known_sheets_.insert(sheet.value());
    clock_.onDirty();
  }
  void onSheetRemoved(SheetRef sheet) override {
    known_sheets_.erase(sheet.value());
    identity_.forget(identity_.lookup(sheet.value(), KeySpace::Sheet), KeySpace::Sheet);
    clock_.onDirty();
  }
  void onSheetDisabled(SheetRef, bool) override { clock_.onDirty(); }
  void onSheetMedia(SheetRef, std::string_view) override { clock_.onDirty(); }
  void onSheetOwner(SheetRef sheet, NodeRef) override {
    // Applicable-without-RuleAdded: materialize sheet id from view.
    if (!known_sheets_.count(sheet.value())) {
      identity_.assign(sheet.value(), KeySpace::Sheet);
      known_sheets_.insert(sheet.value());
    }
    clock_.onDirty();
  }
  void onRuleInserted(SheetRef sheet, RuleRef rule, uint32_t) override {
    identity_.assign(sheet.value(), KeySpace::Sheet);
    identity_.assign(rule.value(), KeySpace::Rule);
    known_sheets_.insert(sheet.value());
    known_rules_.insert(rule.value());
    clock_.onDirty();
  }
  void onRuleDeleted(SheetRef, uint32_t) override {}
  void onRuleReplaced(SheetRef, uint32_t, RuleRef) override {}
  void onRuleCondition(RuleRef, std::string_view) override {}
  void onRuleSelector(RuleRef, std::string_view) override {}
  void onDeclaration(RuleRef, std::string_view, AtomRef, bool) override {}
  void onDeclarationRemoved(RuleRef, std::string_view) override {}
  void onScroll(NodeRef, float, float) override {}
  void onFormControl(NodeRef, std::string_view, std::string_view) override {}
  void onMedia(NodeRef, int) override {}
  void onLoad(NodeRef, bool) override {}
  void onPrompt(RequestId, PromptKind, std::string_view) override {}

  std::vector<uint8_t> snapshot() const { return Snapshot::capture(table_); }

 private:
  static void staticFlush(void* self) { static_cast<Producer*>(self)->doFlush(); }

  void doFlush() {
    if (ledger_.empty() && table_.size() > 0 && !pending_establish_) {
      // Still may need to publish establish — handled below
    }

    scratch_.clear();
    PatchBuilder b(scratch_);
    b.begin();

    // Structural runs first (ISA order preference: NodeNew, then Insert, attrs, …)
    auto runs = ledger_.drainChildrenRuns();
    for (const auto& run : runs) {
      if (run.change == ChildChange::Inserted) {
        std::vector<NodeId> ids;
        NodeId parentId = identity_.lookup(run.parent, KeySpace::Node);
        NodeId beforeId = run.before ? identity_.lookup(run.before, KeySpace::Node) : 0;
        // before in ISA = id of sibling currently at insert point (the node we insert before).
        // Our mark stores prevSibling handle; ISA before = next of prev = first of old or 0.
        if (run.before) {
          auto* prevRow = table_.find(beforeId);
          beforeId = prevRow ? prevRow->nextSibling : 0;
        } else {
          beforeId = 0;  // insert at start → before = old first; resolve from table
          // Find first child of parent
          for (const auto& [id, r] : table_.rows()) {
            (void)id;
            if (r.parent == parentId && r.prevSibling == 0) {
              beforeId = r.id;
              break;
            }
          }
        }
        NodeId prevId = run.before ? identity_.lookup(run.before, KeySpace::Node) : 0;
        for (auto ch : run.children) {
          NodeRef href{ch};
          LiveDescriptor live(view_, identity_, href);
          if (!table_.has(live.id())) {
            DirtyMask mask = DirtyMask::create();
            auto chg = emit(nullptr, &live, mask);
            if (!chg.empty()) {
              chg[0].parent = parentId;
              chg[0].prevSibling = prevId;
              chg[0].value = std::string(view_.characterData(href));
              uint32_t ac = view_.attrCount(href);
              for (uint32_t i = 0; i < ac; ++i) {
                std::string_view an, av;
                view_.attrAt(href, i, an, av);
                AttrChange a{std::string(an), std::string(av), false, hashAttr(an, av)};
                chg[0].attrs.push_back(std::move(a));
              }
              b.nodeNew(chg[0].id, chg[0].kind, chg[0].ns, chg[0].name);
              for (const auto& a : chg[0].attrs) {
                if (!a.deleted) b.attrSet(chg[0].id, a.name, a.value);
              }
              table_.apply(chg);
              if (postcondition_) {
                for (const auto& a : chg[0].attrs) {
                  assert(table_.fieldMatches(chg[0].id, "a:" + a.name, a.hash));
                }
              }
            }
          }
          ids.push_back(identity_.lookup(ch, KeySpace::Node));
          // Update topology in table for insert
          {
            RowChange d;
            d.op = RowOp::Diff;
            d.id = identity_.lookup(ch, KeySpace::Node);
            auto* row = table_.find(d.id);
            if (row) {
              d.kind = row->kind;
              d.ns = row->ns;
              d.name = row->name;
              d.value = row->value;
              d.parent = parentId;
              d.prevSibling = prevId;
              for (const auto& [n, v] : row->attrs) {
                d.attrs.push_back({n, v, false, hashAttr(n, v)});
              }
              table_.apply({d});
            }
          }
          prevId = identity_.lookup(ch, KeySpace::Node);
        }
        // One INSERT, before once
        NodeId isaBefore = 0;
        if (!ids.empty()) {
          auto* first = table_.find(ids.front());
          if (first && first->nextSibling) {
            // before = node that was after insert point — use next of last? 
            // ISA: insert before `before`. After linking, first's nextSibling is the old neighbor.
          }
          // Recompute before from first child's next after link… Actually at mark time:
          // before handle was prev; ISA before = sibling we insert before = old child that had that prev.
          isaBefore = 0;
          if (run.before == 0) {
            // inserted at beginning: before = whoever is now next of first
            auto* f = table_.find(ids.front());
            isaBefore = f ? f->nextSibling : 0;
          } else {
            auto* f = table_.find(ids.back());
            isaBefore = f ? f->nextSibling : 0;
          }
        }
        b.insert(parentId, isaBefore, ids);
      } else {
        std::vector<NodeId> ids;
        NodeId parentId = identity_.lookup(run.parent, KeySpace::Node);
        for (auto ch : run.children) {
          NodeId id = identity_.lookup(ch, KeySpace::Node);
          ids.push_back(id);
          table_.apply({RowChange{RowOp::Remove, id}});
          identity_.forget(id);
        }
        b.remove(parentId, ids);
      }
    }

    // Field marks
    ledger_.drainFields([&](OpaqueRef node, DirtyKind kind, std::string_view field) {
      NodeRef href{node};
      LiveDescriptor live(view_, identity_, href);
      RowDescriptor prev(table_.find(live.id()));
      DirtyMask mask;
      if (kind == DirtyKind::Attr) {
        mask.attrs.push_back(std::string(field));
      } else if (kind == DirtyKind::Value) {
        mask.value = true;
      } else {
        mask = DirtyMask::full();
      }
      const NodeDescriptor* p = table_.has(live.id()) ? static_cast<const NodeDescriptor*>(&prev)
                                                      : nullptr;
      auto chg = emit(p, &live, mask);
      if (chg.empty()) return;
      if (mask.value) {
        chg[0].value = std::string(view_.characterData(href));
        b.textSet(live.id(), chg[0].value);
      }
      for (auto& a : chg[0].attrs) {
        if (a.deleted) {
          b.attrDel(live.id(), a.name);
        } else {
          std::string_view v;
          view_.attr(href, a.name, v);
          a.value = std::string(v);
          a.hash = hashAttr(a.name, a.value);
          b.attrSet(live.id(), a.name, a.value);
        }
      }
      if (!chg[0].value.empty() || !chg[0].attrs.empty() || mask.value) {
        if (table_.has(live.id())) {
          auto* row = table_.find(live.id());
          chg[0].parent = row->parent;
          chg[0].prevSibling = row->prevSibling;
          chg[0].kind = row->kind;
          chg[0].ns = row->ns;
          chg[0].name = row->name;
          if (!mask.value) chg[0].value = row->value;
        }
        table_.apply(chg);
        if (postcondition_) {
          for (const auto& a : chg[0].attrs) {
            if (!a.deleted)
              assert(table_.fieldMatches(live.id(), "a:" + a.name, a.hash));
          }
          if (mask.value)
            assert(table_.fieldMatches(live.id(), "value", hashValue(chg[0].value)));
        }
      }
      (void)kind;
    });

    assert(table_.checkInvariants());

    auto span = b.end();
    if (span.empty()) return;
    uint32_t seq = sequence_.next();
    uplink_.publish(doc_, seq, span);
  }

  DocumentId doc_;
  const IDocumentView& view_;
  IPatchUplink& uplink_;
  Identity identity_;
  ProducerTable table_;
  DirtyLedger ledger_;
  PatchSequence sequence_;
  PatchClock clock_;
  std::vector<uint8_t> scratch_;
  bool pending_establish_{false};
  bool postcondition_{false};
  std::unordered_set<uint32_t> known_sheets_;
  std::unordered_set<uint32_t> known_rules_;
};

}  // namespace speculum::producer
