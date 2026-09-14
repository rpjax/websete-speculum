// CSSOM no mesmo sequence/IdentityMap. Cadáver de regra some no DROP.
#include "speculum/Producer.h"

#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>

using namespace speculum;

struct FakeNode {
  NodeKind kind = NodeKind::Element;
  ElementNs ns = ElementNs::Html;
  std::string uri;
  std::string name;
  std::string value;
  std::vector<AttrPair> attrs;
  std::vector<FakeNode*> children;
  FakeNode* parent = nullptr;
};

class FakeDom : public NodeSource {
 public:
  FakeNode* makeElement(const std::string& tag) {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Element;
    n->name = tag;
    FakeNode* raw = n.get();
    owned_.push_back(std::move(n));
    return raw;
  }
  FakeNode* makeSheet(const std::string& name) {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Sheet;
    n->name = name;
    FakeNode* raw = n.get();
    owned_.push_back(std::move(n));
    sheets_.push_back(raw);
    return raw;
  }
  FakeNode* makeRule(FakeNode* sheet, const std::string& text) {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Rule;
    n->value = text;
    n->parent = sheet;
    FakeNode* raw = n.get();
    owned_.push_back(std::move(n));
    rules_[sheet].push_back(raw);
    return raw;
  }
  void dropRule(FakeNode* sheet, FakeNode* rule) {
    auto& list = rules_[sheet];
    std::vector<FakeNode*> kept;
    for (auto* r : list) {
      if (r != rule) kept.push_back(r);
    }
    list.swap(kept);
  }
  void append(FakeNode* parent, FakeNode* child) {
    parent->children.push_back(child);
    child->parent = parent;
  }
  void setDocument(FakeNode* n) { document_ = n; }

  NodeKind kindOf(const void* n) const override { return at(n)->kind; }
  ElementNs nsOf(const void* n) const override { return at(n)->ns; }
  std::string uriOf(const void* n) const override { return at(n)->uri; }
  std::string nameOf(const void* n) const override { return at(n)->name; }
  std::string valueOf(const void* n) const override { return at(n)->value; }
  std::vector<AttrPair> attrsOf(const void* n) const override { return at(n)->attrs; }
  std::vector<const void*> childrenOf(const void* n) const override {
    std::vector<const void*> out;
    for (auto* c : at(n)->children) out.push_back(c);
    return out;
  }
  bool isConnected(const void* n) const override {
    const FakeNode* node = at(n);
    if (node->kind == NodeKind::Sheet || node->kind == NodeKind::Rule) return true;
    return node->parent != nullptr || n == document_;
  }
  std::vector<const void*> cssomSheets() const override {
    std::vector<const void*> out;
    for (auto* s : sheets_) out.push_back(s);
    return out;
  }
  std::vector<const void*> cssomRulesOf(const void* sheet) const override {
    auto it = rules_.find(static_cast<FakeNode*>(const_cast<void*>(sheet)));
    std::vector<const void*> out;
    if (it == rules_.end()) return out;
    for (auto* r : it->second) out.push_back(r);
    return out;
  }
  std::string cssomRuleTextOf(const void* rule) const override { return at(rule)->value; }
  const void* cssomSheetOf(const void* rule) const override { return at(rule)->parent; }

 private:
  static const FakeNode* at(const void* n) { return static_cast<const FakeNode*>(n); }
  std::vector<std::unique_ptr<FakeNode>> owned_;
  std::vector<FakeNode*> sheets_;
  std::map<FakeNode*, std::vector<FakeNode*>> rules_;
  FakeNode* document_ = nullptr;
};

static int Fail(const char* msg) {
  std::cerr << "FALHOU: " << msg << "\n";
  return 1;
}

int main() {
  FakeDom dom;
  FakeNode* document = dom.makeElement("#document");
  FakeNode* html = dom.makeElement("html");
  dom.setDocument(document);
  dom.append(document, html);

  Producer p(dom, kContextIdRoot, 0);
  if (p.resyncVirtual(document).empty()) return Fail("boot vazio");
  const uint32_t seqBoot = p.sequence();

  FakeNode* sheet = dom.makeSheet("author");
  FakeNode* rule = dom.makeRule(sheet, "div { color: red; }");
  p.onSheetAdded(sheet);
  p.onRuleAdded(sheet, rule);
  auto cssom = p.emitFrame();
  if (cssom.empty()) return Fail("CSSOM nao emitiu");
  if (p.sequence() != seqBoot + 1) return Fail("CSSOM nao compartilhou o sequence do DOM");

  const uint32_t sheetId = p.identity().idOf(sheet);
  const uint32_t ruleId = p.identity().idOf(rule);
  const Row* sheetRow = p.table().getRow(sheetId);
  const Row* ruleRow = p.table().getRow(ruleId);
  if (!sheetRow || sheetRow->kind != static_cast<uint32_t>(NodeKind::Sheet)) {
    return Fail("sheet ausente");
  }
  if (!ruleRow || ruleRow->kind != static_cast<uint32_t>(NodeKind::Rule)) {
    return Fail("rule ausente");
  }
  if (ruleRow->parent != sheetId) return Fail("rule parent != sheet");

  FakeNode* span = dom.makeElement("span");
  dom.append(html, span);
  p.onInserted(html, span);
  auto mixed = p.emitFrame();
  if (mixed.empty()) return Fail("DOM+CSSOM no mesmo tick nao emitiu");

  const uint64_t hashLive = p.table().tableHash();
  dom.dropRule(sheet, rule);
  p.onRuleRemoved(sheet, rule);
  auto dropped = p.emitFrame();
  if (dropped.empty()) return Fail("RULE_DROP nao emitiu");
  if (p.table().has(ruleId)) return Fail("cadaver de regra ficou na tabela");
  if (p.identity().idOf(rule) != kNone) return Fail("cadaver de regra ficou no mapa");
  if (p.table().tableHash() == hashLive) return Fail("DROP nao mudou tableHash");

  auto resync = p.resyncVirtual(document);
  if (resync.empty()) return Fail("resync CSSOM vazio");
  if (!p.table().has(sheetId) && p.identity().idOf(sheet) == kNone) {
    // ids reassigned on resyncVirtual
  }
  const uint32_t sheetAfter = p.identity().idOf(sheet);
  if (sheetAfter == kNone) return Fail("sheet sumiu no resync");
  const Row* after = p.table().getRow(sheetAfter);
  if (!after || after->kind != static_cast<uint32_t>(NodeKind::Sheet)) {
    return Fail("resync nao reescreveu sheet");
  }

  std::cout << "ok: CSSOM no mesmo sequence; cadaver de regra; resync sheets\n";
  return 0;
}
