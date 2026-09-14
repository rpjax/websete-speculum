// Produtor: NODE_NEW de host aninhado — bit 7 + C, hold até C ≥ 2.
#include "speculum/Producer.h"

#include <cstdint>
#include <iostream>
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
  bool nestedHost = false;
  uint32_t childScopeId = 0;
};

class FakeDom : public NodeSource {
 public:
  FakeNode* makeElement(const std::string& tag, bool nestedHost = false,
                        uint32_t childScopeId = 0) {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Element;
    n->name = tag;
    n->nestedHost = nestedHost;
    n->childScopeId = childScopeId;
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

  void append(FakeNode* parent, FakeNode* child) {
    parent->children.push_back(child);
    child->parent = parent;
  }

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
  bool isNestedHost(const void* n) const override { return at(n)->nestedHost; }
  uint32_t childScopeIdOf(const void* n) const override {
    const uint32_t c = at(n)->childScopeId;
    return c >= 2 ? c : 0;
  }
  bool isConnected(const void* n) const override {
    return at(n)->parent != nullptr || n == document_;
  }
  void setDocument(FakeNode* n) { document_ = n; }

  static FakeNode* at(const void* n) {
    return const_cast<FakeNode*>(static_cast<const FakeNode*>(n));
  }

 private:
  std::vector<std::unique_ptr<FakeNode>> owned_;
  FakeNode* document_ = nullptr;
};

static bool ReadU32(const std::vector<uint8_t>& f, size_t& o, uint32_t& v) {
  if (o + 4 > f.size()) return false;
  v = static_cast<uint32_t>(f[o]) | (static_cast<uint32_t>(f[o + 1]) << 8) |
      (static_cast<uint32_t>(f[o + 2]) << 16) | (static_cast<uint32_t>(f[o + 3]) << 24);
  o += 4;
  return true;
}

static bool ReadU16(const std::vector<uint8_t>& f, size_t& o, uint16_t& v) {
  if (o + 2 > f.size()) return false;
  v = static_cast<uint16_t>(f[o] | (f[o + 1] << 8));
  o += 2;
  return true;
}

static std::vector<uint32_t> ChildScopes(const std::vector<uint8_t>& f) {
  std::vector<uint32_t> out;
  if (f.size() < kFramePrefixBytes) return out;
  size_t o = kFramePrefixBytes;
  uint32_t strCount = 0;
  if (!ReadU32(f, o, strCount)) return out;
  for (uint32_t i = 0; i < strCount; ++i) {
    uint32_t len = 0;
    if (!ReadU32(f, o, len) || o + len > f.size()) return out;
    o += len;
  }
  uint32_t opCount = 0;
  if (!ReadU32(f, o, opCount)) return out;
  for (uint32_t i = 0; i < opCount; ++i) {
    if (o >= f.size()) return out;
    const uint8_t code = f[o++];
    if (code == static_cast<uint8_t>(Op::NodeNew)) {
      uint32_t id = 0;
      if (!ReadU32(f, o, id) || o >= f.size()) return out;
      const uint8_t kind = f[o++];
      if (kind == static_cast<uint8_t>(NodeKind::Element)) {
        if (o >= f.size()) return out;
        const uint8_t ns = f[o++];
        if ((ns & 0x0f) == static_cast<uint8_t>(ElementNs::Custom)) {
          uint32_t uriRef = 0;
          if (!ReadU32(f, o, uriRef)) return out;
        }
        uint32_t nameRef = 0;
        if (!ReadU32(f, o, nameRef)) return out;
        uint16_t attrCount = 0;
        if (!ReadU16(f, o, attrCount)) return out;
        for (uint16_t a = 0; a < attrCount; ++a) {
          uint32_t nr = 0, vr = 0;
          if (!ReadU32(f, o, nr) || !ReadU32(f, o, vr)) return out;
        }
        if (ns & kElementNsNestedHostBit) {
          uint32_t c = 0;
          if (!ReadU32(f, o, c)) return out;
          out.push_back(c);
        }
      } else if (kind == static_cast<uint8_t>(NodeKind::Text) ||
                 kind == static_cast<uint8_t>(NodeKind::Comment) ||
                 kind == static_cast<uint8_t>(NodeKind::Doctype)) {
        uint32_t ref = 0;
        if (!ReadU32(f, o, ref)) return out;
      } else {
        return out;
      }
    } else if (code == static_cast<uint8_t>(Op::Insert)) {
      uint32_t parent = 0, before = 0;
      uint16_t n = 0;
      if (!ReadU32(f, o, parent) || !ReadU32(f, o, before) || !ReadU16(f, o, n)) return out;
      o += static_cast<size_t>(n) * 4;
    } else if (code == static_cast<uint8_t>(Op::Check)) {
      if (o + 1 + 4 + 4 + 8 > f.size()) return out;
      o += 1 + 4 + 4 + 8;
    } else {
      return out;
    }
  }
  return out;
}

static int Fail(const char* msg) {
  std::cerr << "FALHOU: " << msg << "\n";
  return 1;
}

int main() {
  {
    FakeDom dom;
    FakeNode* document = dom.makeElement("#document");
    FakeNode* html = dom.makeElement("html");
    FakeNode* body = dom.makeElement("body");
    FakeNode* iframe = dom.makeElement("iframe", true, 2);
    FakeNode* text = dom.makeText("host");
    dom.setDocument(document);
    dom.append(document, html);
    dom.append(html, body);
    dom.append(body, iframe);
    dom.append(body, text);

    Producer p(dom, kContextIdRoot, 0);
    auto frame = p.resyncVirtual(document);
    if (frame.empty()) return Fail("bootstrap com host C=2 nao emitiu");
    auto scopes = ChildScopes(frame);
    if (scopes.size() != 1) return Fail("esperava um childScopeId no NODE_NEW");
    if (scopes[0] != 2) return Fail("childScopeId nao e 2");
    std::cout << "ok: NODE_NEW host C=2\n";
  }

  {
    FakeDom dom;
    FakeNode* document = dom.makeElement("#document");
    FakeNode* html = dom.makeElement("html");
    FakeNode* body = dom.makeElement("body");
    FakeNode* iframe = dom.makeElement("iframe", true, 0);
    dom.setDocument(document);
    dom.append(document, html);
    dom.append(html, body);
    dom.append(body, iframe);

    Producer p(dom, kContextIdRoot, 0);
    auto held = p.resyncVirtual(document);
    if (!held.empty() && !ChildScopes(held).empty()) {
      return Fail("host sem C emitiu NODE_NEW nested");
    }

    FakeDom::at(iframe)->childScopeId = 2;
    auto ready = p.emitFrame();
    if (ready.empty()) return Fail("host com C depois do hold nao emitiu");
    auto scopes = ChildScopes(ready);
    if (scopes.size() != 1 || scopes[0] != 2) {
      return Fail("hold->C=2 nao produziu um NODE_NEW com 2");
    }

    auto again = p.emitFrame();
    if (!again.empty() && !ChildScopes(again).empty()) {
      return Fail("segundo emit repetiu NODE_NEW do host");
    }
    std::cout << "ok: hold ate C>=2, um NODE_NEW so\n";
  }

  {
    FakeDom dom;
    FakeNode* document = dom.makeElement("#document");
    FakeNode* html = dom.makeElement("html");
    FakeNode* body = dom.makeElement("body");
    FakeNode* iframe = dom.makeElement("iframe", true, 1);
    dom.setDocument(document);
    dom.append(document, html);
    dom.append(html, body);
    dom.append(body, iframe);

    Producer p(dom, kContextIdRoot, 0);
    auto frame = p.resyncVirtual(document);
    if (!frame.empty() && !ChildScopes(frame).empty()) {
      return Fail("C=1 no host classificou nested");
    }
    std::cout << "ok: C=1 no host nao e nested\n";
  }

  std::cout << "produtor nested: ok\n";
  return 0;
}
