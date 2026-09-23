#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "domain/ids/Ids.hpp"

namespace speculum::gecko {

// Strong ownership of sheet/rule live data — MUST sit on the process, never the Document.
// (ITERACAO-06: no cycle Document → table → sheet → Document.)
struct CssomRuleData {
  RuleRef id{};
  SheetRef sheet{};
  std::string selector;
};

struct CssomSheetData {
  SheetRef id{};
  NodeRef owner{};
  bool applicable{false};
  bool linked{false};
  std::vector<RuleRef> rules;
};

class CssomTable {
 public:
  SheetRef addSheet(NodeRef owner, bool linked) {
    SheetRef id{++sheet_seq_};
    auto sh = std::make_shared<CssomSheetData>();
    sh->id = id;
    sh->owner = owner;
    sh->linked = linked;
    sheets_[id.value()] = sh;
    order_.push_back(id);
    return id;
  }

  RuleRef addRule(SheetRef sheet, std::string_view selector) {
    auto sit = sheets_.find(sheet.value());
    if (sit == sheets_.end()) return {};
    RuleRef id{++rule_seq_};
    auto r = std::make_shared<CssomRuleData>();
    r->id = id;
    r->sheet = sheet;
    r->selector = std::string(selector);
    rules_[id.value()] = r;
    sit->second->rules.push_back(id);
    return id;
  }

  void setApplicable(SheetRef sheet, bool v) {
    auto it = sheets_.find(sheet.value());
    if (it != sheets_.end()) it->second->applicable = v;
  }

  std::shared_ptr<CssomSheetData> sheet(SheetRef id) const {
    auto it = sheets_.find(id.value());
    return it == sheets_.end() ? nullptr : it->second;
  }

  std::shared_ptr<CssomRuleData> rule(RuleRef id) const {
    auto it = rules_.find(id.value());
    return it == rules_.end() ? nullptr : it->second;
  }

  SheetRef sheetAt(uint32_t i) const {
    return i < order_.size() ? order_[i] : SheetRef{};
  }

  bool hasSheet(SheetRef id) const { return sheets_.count(id.value()) != 0; }
  size_t sheetCount() const { return sheets_.size(); }
  size_t ruleCount() const { return rules_.size(); }

  // Drop all sheets for a dying document (owner host+gen tracked by caller).
  void clearDocument(NodeRef /*rootHint*/) {
    // Process-owned: explicit clear when document dies — no back-edge from Document.
    sheets_.clear();
    rules_.clear();
    order_.clear();
  }

  void clear() {
    sheets_.clear();
    rules_.clear();
    order_.clear();
  }

 private:
  uint32_t sheet_seq_{0};
  uint32_t rule_seq_{0};
  std::unordered_map<uint32_t, std::shared_ptr<CssomSheetData>> sheets_;
  std::unordered_map<uint32_t, std::shared_ptr<CssomRuleData>> rules_;
  std::vector<SheetRef> order_;
};

}  // namespace speculum::gecko
