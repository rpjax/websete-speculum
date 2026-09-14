// ShadowRoot no mesmo IdentityMap: mode 0/1, fora da cadeia de luz.
#include "speculum/Producer.h"

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
  FakeNode* shadowRoot = nullptr;
  FakeNode* shadowHost = nullptr;
  uint8_t shadowMode = 0;
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
  FakeNode* makeShadow(FakeNode* host, uint8_t mode) {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::ShadowRoot;
    n->shadowHost = host;
    n->shadowMode = mode;
    FakeNode* raw = n.get();
    host->shadowRoot = raw;
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
  const void* shadowRootOf(const void* n) const override { return at(n)->shadowRoot; }
  const void* shadowHostOf(const void* n) const override { return at(n)->shadowHost; }
  uint8_t shadowModeOf(const void* n) const override { return at(n)->shadowMode; }
  bool isConnected(const void* n) const override {
    return at(n)->parent != nullptr || n == document_ || at(n)->shadowHost != nullptr;
  }

 private:
  static const FakeNode* at(const void* n) { return static_cast<const FakeNode*>(n); }
  std::vector<std::unique_ptr<FakeNode>> owned_;
  FakeNode* document_ = nullptr;
};

static int Fail(const char* msg) {
  std::cerr << "FALHOU: " << msg << "\n";
  return 1;
}

int main() {
  FakeDom dom;
  FakeNode* document = dom.makeElement("#document");
  FakeNode* host = dom.makeElement("div");
  FakeNode* light = dom.makeText("luz");
  FakeNode* sr = dom.makeShadow(host, 0);
  FakeNode* inside = dom.makeText("sombra");
  dom.setDocument(document);
  dom.append(document, host);
  dom.append(host, light);
  dom.append(sr, inside);

  Producer p(dom, kContextIdRoot, 0);
  if (p.resyncVirtual(document).empty()) return Fail("boot vazio");

  const uint32_t hostId = p.identity().idOf(host);
  const uint32_t srId = p.identity().idOf(sr);
  const uint32_t lightId = p.identity().idOf(light);
  const uint32_t insideId = p.identity().idOf(inside);
  if (hostId == kNone || srId == kNone) return Fail("host/shadow sem id");
  if (p.table().shadowRootOf(hostId) != srId) return Fail("shadow nao ligado ao host");
  const Row* srRow = p.table().getRow(srId);
  if (!srRow || srRow->kind != static_cast<uint32_t>(NodeKind::ShadowRoot)) {
    return Fail("linha nao e SHADOW_ROOT");
  }
  if (srRow->parent != hostId) return Fail("parent do shadow != host");
  auto lightKids = p.table().orderedChildIds(hostId);
  if (lightKids.size() != 1 || lightKids[0] != lightId) {
    return Fail("shadow entrou na cadeia de luz");
  }
  auto shadowKids = p.table().orderedChildIds(srId);
  if (shadowKids.size() != 1 || shadowKids[0] != insideId) {
    return Fail("filho do shadow ausente");
  }

  FakeNode* closedHost = dom.makeElement("closed-host");
  FakeNode* closed = dom.makeShadow(closedHost, 1);
  dom.append(document, closedHost);
  p.onInserted(document, closedHost);
  if (p.emitFrame().empty()) return Fail("closed host nao emitiu");
  const uint32_t closedId = p.identity().idOf(closed);
  const Row* closedRow = p.table().getRow(closedId);
  if (!closedRow || closedRow->kind != static_cast<uint32_t>(NodeKind::ShadowRoot)) {
    return Fail("closed shadow ausente");
  }

  FakeNode* later = dom.makeText("depois");
  dom.append(sr, later);
  p.onInserted(sr, later);
  if (p.emitFrame().empty()) return Fail("filho do shadow depois do boot nao emitiu");
  auto after = p.table().orderedChildIds(srId);
  if (after.size() != 2 || after[1] != p.identity().idOf(later)) {
    return Fail("insert no shadow fora da ordem");
  }

  std::cout << "ok: shadow mode 0/1 fora da cadeia de luz\n";
  return 0;
}
