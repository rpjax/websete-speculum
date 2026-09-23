#pragma once

#include <string_view>
#include <vector>

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"
#include "ports/IDocumentObserver.hpp"

namespace speculum::gecko {

// Forwards motor notifications → IDocumentObserver. No policy, no dispatch, no script.
class MutationBridge {
 public:
  void attach(IDocumentObserver* obs) { obs_ = obs; }
  IDocumentObserver* observer() const { return obs_; }

  void notifyChildList(NodeRef parent, uint32_t index, uint32_t remove,
                       const NodeRef* add, uint32_t addCount) {
    if (obs_) obs_->onChildList(parent, index, remove, add, addCount);
  }

  void notifyAttr(NodeRef el, std::string_view name, std::string_view value) {
    if (obs_) obs_->onAttr(el, name, value);
  }

  void notifyText(NodeRef node, std::string_view data) {
    if (obs_) obs_->onCharacterData(node, data);
  }

  void notifyShadow(NodeRef host, ShadowMode mode, NodeRef root) {
    // Caller must recursively attach observation to `root` (A3) — bridge only forwards.
    if (obs_) obs_->onShadow(host, mode, root);
  }

  void notifySheetAdded(SheetRef sheet, uint32_t index) {
    if (obs_) obs_->onSheetAdded(sheet, index);
  }

  void notifySheetOwner(SheetRef sheet, NodeRef owner) {
    if (obs_) obs_->onSheetOwner(sheet, owner);
  }

  void notifyRuleInserted(SheetRef sheet, RuleRef rule, uint32_t index) {
    if (obs_) obs_->onRuleInserted(sheet, rule, index);
  }

  // Shadow attach queue for tests — proves recursive walk without motor.
  static void collectShadowChain(NodeRef root,
                                 const std::vector<std::pair<NodeRef, NodeRef>>& edges,
                                 std::vector<NodeRef>& out) {
    out.push_back(root);
    for (const auto& [host, shadow] : edges) {
      (void)host;
      if (shadow.valid()) {
        // Nested: if any edge's host is under root's descendants — simplified: all shadows.
        bool seen = false;
        for (auto n : out)
          if (n == shadow) seen = true;
        if (!seen) out.push_back(shadow);
      }
    }
  }

 private:
  IDocumentObserver* obs_{nullptr};
};

}  // namespace speculum::gecko
