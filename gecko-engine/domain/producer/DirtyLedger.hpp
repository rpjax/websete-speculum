#pragma once

#include <cstdint>
#include <set>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "domain/producer/Types.hpp"

namespace speculum::producer {

struct ChildMark {
  OpaqueRef parent{0};
  OpaqueRef child{0};
  ChildChange change{};
  OpaqueRef prevSiblingHandle{0};
};

class DirtyLedger {
 public:
  void markField(OpaqueRef node, DirtyKind kind, std::string_view field) {
    auto& m = fields_[node];
    m.node = node;
    m.kind = kind;
    if (!field.empty()) m.fields.insert(std::string(field));
  }

  void markChild(OpaqueRef parent, OpaqueRef child, ChildChange change,
                 OpaqueRef prevSibling = 0) {
    children_[parent].push_back(ChildMark{parent, child, change, prevSibling});
  }

  bool empty() const { return fields_.empty() && children_.empty(); }

  void discardPending() {
    fields_.clear();
    children_.clear();
  }

  template <class F>
  void drainFields(F&& fn) {
    for (auto& [k, m] : fields_) {
      (void)k;
      if (m.fields.empty()) {
        fn(m.node, m.kind, std::string_view{});
      } else {
        for (const auto& f : m.fields) fn(m.node, m.kind, std::string_view(f));
      }
    }
    fields_.clear();
  }

  struct ChildRun {
    OpaqueRef parent{0};
    ChildChange change{};
    OpaqueRef before{0};  // handle of node before the run (ISA before = id of this after resolve)
    std::vector<OpaqueRef> children;
  };

  // One INSERT/REMOVE per sibling run — before computed once per run.
  std::vector<ChildRun> drainChildrenRuns() {
    std::vector<ChildRun> runs;
    for (auto& [parent, marks] : children_) {
      size_t i = 0;
      while (i < marks.size()) {
        ChildRun run;
        run.parent = parent;
        run.change = marks[i].change;
        run.before = marks[i].prevSiblingHandle;
        run.children.push_back(marks[i].child);
        ++i;
        while (i < marks.size() && marks[i].change == run.change) {
          // Continue run when this child's prev is the previous child in the run.
          if (run.change == ChildChange::Inserted &&
              marks[i].prevSiblingHandle == run.children.back()) {
            run.children.push_back(marks[i].child);
            ++i;
            continue;
          }
          if (run.change == ChildChange::Removed) {
            run.children.push_back(marks[i].child);
            ++i;
            continue;
          }
          break;
        }
        runs.push_back(std::move(run));
      }
    }
    children_.clear();
    return runs;
  }

 private:
  struct FieldEntry {
    OpaqueRef node{0};
    DirtyKind kind{};
    std::set<std::string> fields;
  };
  std::unordered_map<OpaqueRef, FieldEntry> fields_;
  std::unordered_map<OpaqueRef, std::vector<ChildMark>> children_;
};

}  // namespace speculum::producer
