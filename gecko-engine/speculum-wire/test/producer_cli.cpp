// CLI do Producer: stdin linha a linha; stdout FRAME hex / SNAP hex / EMPTY / OK.
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
  std::vector<FormProp> formProps;
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
  FakeNode* makeText(const std::string& v) {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Text;
    n->value = v;
    FakeNode* raw = n.get();
    owned_.push_back(std::move(n));
    return raw;
  }
  FakeNode* makeSheet() {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Sheet;
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
  void append(FakeNode* parent, FakeNode* child) {
    if (child->parent) detach(child);
    parent->children.push_back(child);
    child->parent = parent;
  }
  void detach(FakeNode* child) {
    if (!child->parent) return;
    auto& kids = child->parent->children;
    std::vector<FakeNode*> kept;
    for (auto* k : kids) {
      if (k != child) kept.push_back(k);
    }
    kids.swap(kept);
    child->parent = nullptr;
  }
  void setDocument(FakeNode* n) { document_ = n; }
  FakeNode* document() const { return document_; }

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
  std::vector<FormProp> formPropsOf(const void* n) const override { return at(n)->formProps; }
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
  bool isSheet(const void* n) const override { return at(n)->kind == NodeKind::Sheet; }
  bool isRule(const void* n) const override { return at(n)->kind == NodeKind::Rule; }

 private:
  static const FakeNode* at(const void* n) { return static_cast<const FakeNode*>(n); }
  std::vector<std::unique_ptr<FakeNode>> owned_;
  std::vector<FakeNode*> sheets_;
  std::map<FakeNode*, std::vector<FakeNode*>> rules_;
  FakeNode* document_ = nullptr;
};

static bool ParseU32(const std::string& s, uint32_t* out) {
  if (s.empty()) return false;
  uint32_t v = 0;
  for (char c : s) {
    if (c < '0' || c > '9') return false;
    uint32_t d = static_cast<uint32_t>(c - '0');
    if (v > (0xffffffffu - d) / 10) return false;
    v = v * 10 + d;
  }
  *out = v;
  return true;
}

static std::string Hex(const std::vector<uint8_t>& bytes) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  out.resize(bytes.size() * 2);
  for (size_t i = 0; i < bytes.size(); ++i) {
    out[i * 2] = digits[bytes[i] >> 4];
    out[i * 2 + 1] = digits[bytes[i] & 0xf];
  }
  return out;
}

static std::vector<std::string> Split(const std::string& line) {
  std::vector<std::string> parts;
  std::string cur;
  for (char c : line) {
    if (c == ' ' || c == '\t' || c == '\r') {
      if (!cur.empty()) {
        parts.push_back(cur);
        cur.clear();
      }
    } else {
      cur.push_back(c);
    }
  }
  if (!cur.empty()) parts.push_back(cur);
  return parts;
}

static std::string Rest(const std::vector<std::string>& parts, size_t from) {
  std::string out;
  for (size_t i = from; i < parts.size(); ++i) {
    if (i > from) out.push_back(' ');
    out += parts[i];
  }
  return out;
}

int main() {
  FakeDom dom;
  std::map<std::string, FakeNode*> named;
  Producer* producer = nullptr;
  FakeNode* document = nullptr;

  auto emit = [&](bool honorHaltTick) {
    if (!producer) {
      std::cout << "EMPTY\n";
      return;
    }
    if (honorHaltTick && producer->halted()) {
      std::cout << "EMPTY\n";
      return;
    }
    auto frame = producer->emitFrame();
    if (frame.empty()) {
      std::cout << "EMPTY\n";
      return;
    }
    std::cout << "FRAME " << Hex(frame) << "\n";
  };

  std::string line;
  while (std::getline(std::cin, line)) {
    auto parts = Split(line);
    if (parts.empty()) continue;
    const std::string& cmd = parts[0];

    if (cmd == "boot") {
      document = dom.makeElement("#document");
      FakeNode* html = dom.makeElement("html");
      FakeNode* body = dom.makeElement("body");
      named["html"] = html;
      named["body"] = body;
      named["document"] = document;
      dom.setDocument(document);
      dom.append(document, html);
      dom.append(html, body);
      delete producer;
      producer = new Producer(dom, kContextIdRoot, 0);
      auto boot = producer->resyncVirtual(document);
      if (boot.empty()) {
        std::cout << "EMPTY\n";
      } else {
        std::cout << "FRAME " << Hex(boot) << "\n";
      }
      continue;
    }

    if (!producer || !document) {
      std::cout << "EMPTY\n";
      continue;
    }

    if (cmd == "mk" && parts.size() >= 3) {
      named[parts[2]] = dom.makeElement(parts[1]);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "mktext" && parts.size() >= 3) {
      named[parts[1]] = dom.makeText(Rest(parts, 2));
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "append" && parts.size() >= 3) {
      FakeNode* parent = named[parts[1]];
      FakeNode* child = named[parts[2]];
      if (!parent || !child) {
        std::cout << "EMPTY\n";
        continue;
      }
      dom.append(parent, child);
      producer->onInserted(parent, child);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "detach" && parts.size() >= 2) {
      FakeNode* child = named[parts[1]];
      if (!child) {
        std::cout << "EMPTY\n";
        continue;
      }
      FakeNode* parent = child->parent;
      if (parent) {
        dom.detach(child);
        producer->onRemoved(parent, child);
      }
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "attr" && parts.size() >= 4) {
      FakeNode* n = named[parts[1]];
      if (!n) {
        std::cout << "EMPTY\n";
        continue;
      }
      bool found = false;
      for (auto& a : n->attrs) {
        if (a.name == parts[2]) {
          a.value = Rest(parts, 3);
          found = true;
          break;
        }
      }
      if (!found) n->attrs.push_back(AttrPair{parts[2], Rest(parts, 3)});
      producer->onAttrChanged(n, parts[2]);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "prop" && parts.size() >= 5) {
      FakeNode* n = named[parts[1]];
      uint32_t id = 0;
      if (!n || !ParseU32(parts[2], &id)) {
        std::cout << "EMPTY\n";
        continue;
      }
      FormProp fp;
      fp.id = static_cast<uint8_t>(id);
      if (parts[3] == "bool") {
        fp.value = PropValue::boolean(parts[4] == "1" || parts[4] == "true");
      } else {
        fp.value = PropValue::str(Rest(parts, 4));
      }
      n->formProps.clear();
      n->formProps.push_back(fp);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "sheet" && parts.size() >= 2) {
      FakeNode* sheet = dom.makeSheet();
      named[parts[1]] = sheet;
      producer->onSheetAdded(sheet);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "rule" && parts.size() >= 4) {
      FakeNode* sheet = named[parts[1]];
      if (!sheet) {
        std::cout << "EMPTY\n";
        continue;
      }
      FakeNode* rule = dom.makeRule(sheet, Rest(parts, 3));
      named[parts[2]] = rule;
      producer->onRuleAdded(sheet, rule);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "halt") {
      producer->setHalted(true);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "resume") {
      producer->setHalted(false);
      std::cout << "OK\n";
      continue;
    }
    if (cmd == "tick") {
      emit(true);
      continue;
    }
    if (cmd == "flush") {
      emit(false);
      continue;
    }
    if (cmd == "snapshot") {
      std::cout << "SNAP " << Hex(producer->snapshotDump()) << "\n";
      continue;
    }
    if (cmd == "resync") {
      auto frame = producer->resyncVirtual(document);
      if (frame.empty()) {
        std::cout << "EMPTY\n";
      } else {
        std::cout << "FRAME " << Hex(frame) << "\n";
      }
      continue;
    }
    std::cout << "EMPTY\n";
  }

  delete producer;
  return 0;
}
