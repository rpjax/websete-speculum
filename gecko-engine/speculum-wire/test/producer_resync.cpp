// L0 — as duas forças de resync e preTableHash nos frames ordinários.
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
    return at(n)->parent != nullptr || n == document_;
  }

 private:
  static const FakeNode* at(const void* n) { return static_cast<const FakeNode*>(n); }
  std::vector<std::unique_ptr<FakeNode>> owned_;
  FakeNode* document_ = nullptr;
};

static uint32_t ReadU32(const std::vector<uint8_t>& f, size_t o) {
  return static_cast<uint32_t>(f[o]) | (static_cast<uint32_t>(f[o + 1]) << 8) |
         (static_cast<uint32_t>(f[o + 2]) << 16) | (static_cast<uint32_t>(f[o + 3]) << 24);
}

static uint64_t ReadU64(const std::vector<uint8_t>& f, size_t o) {
  uint64_t v = 0;
  for (int i = 0; i < 8; ++i) v |= static_cast<uint64_t>(f[o + i]) << (8 * i);
  return v;
}

static int Fail(const char* msg) {
  std::cerr << "FALHOU: " << msg << "\n";
  return 1;
}

int main() {
  FakeDom dom;
  FakeNode* document = dom.makeElement("#document");
  FakeNode* html = dom.makeElement("html");
  FakeNode* body = dom.makeElement("body");
  FakeNode* text = dom.makeText("oi");
  dom.setDocument(document);
  dom.append(document, html);
  dom.append(html, body);
  dom.append(body, text);

  Producer p(dom, kContextIdRoot, /*generation=*/7);
  auto boot = p.resyncVirtual(document);
  if (boot.size() < kFramePrefixBytes) return Fail("resyncVirtual curto");
  if ((boot[3] & kFrameFlagResync) == 0) return Fail("cold sem flag de resync");
  if (ReadU64(boot, 20) != 0) return Fail("resync preTableHash nao e 0");
  if (ReadU32(boot, 8) != 7) return Fail("geracao do header mudou no resyncVirtual");
  const uint32_t htmlId = p.identity().idOf(html);
  if (htmlId < 2) return Fail("html sem id apos resyncVirtual");
  const uint64_t afterBoot = p.table().tableHash();
  if (afterBoot == 0) return Fail("tabela vazia depois do cold resync");
  std::cout << "ok: resyncVirtual flag + preTableHash 0 + geracao intacta\n";

  FakeNode* div = dom.makeElement("div");
  dom.append(body, div);
  p.onInserted(body, div);
  auto inc = p.emitFrame();
  if (inc.size() < kFramePrefixBytes) return Fail("frame ordinário vazio");
  if ((inc[3] & kFrameFlagResync) != 0) return Fail("ordinário com flag de resync");
  if (ReadU64(inc, 20) != afterBoot) {
    return Fail("preTableHash do ordinário != tableHash depois do resync");
  }
  if (ReadU64(inc, 20) == 0) return Fail("preTableHash do 2o frame e 0");
  std::cout << "ok: ordinário carrega preTableHash do tick anterior\n";

  const uint32_t htmlBeforeMap = p.identity().idOf(html);
  const uint32_t nextBefore = p.identity().peekNextId();
  auto mapResync = p.emitResyncFrame();
  if (mapResync.size() < kFramePrefixBytes) return Fail("emitResyncFrame vazio");
  if ((mapResync[3] & kFrameFlagResync) == 0) return Fail("mapa sem flag de resync");
  if (p.identity().idOf(html) != htmlBeforeMap) return Fail("força mapa remintou id");
  if (p.identity().peekNextId() != nextBefore) return Fail("força mapa avançou o alocador");
  if (ReadU32(mapResync, 8) != 7) return Fail("geracao mudou no emitResyncFrame");
  std::cout << "ok: emitResyncFrame preserva ids\n";

  FakeNode* extra = dom.makeElement("span");
  dom.append(body, extra);
  p.onInserted(body, extra);
  if (p.emitFrame().empty()) return Fail("span nao emitiu");
  extra->parent = nullptr;
  body->children.pop_back();
  p.onRemoved(body, extra);
  p.onDestroyed(extra);
  if (p.emitFrame().empty()) return Fail("drop do span nao emitiu");
  const uint32_t nextAfterDrop = p.identity().peekNextId();
  if (nextAfterDrop <= nextBefore) return Fail("drop nao consumiu id");

  auto virt = p.resyncVirtual(document);
  if (virt.size() < kFramePrefixBytes) return Fail("resyncVirtual 2 vazio");
  if ((virt[3] & kFrameFlagResync) == 0) return Fail("virtual 2 sem flag");
  if (p.identity().peekNextId() >= nextAfterDrop) {
    return Fail("resyncVirtual nao resetou o alocador");
  }
  if (p.identity().idOf(html) != 2) return Fail("resyncVirtual nao recomeçou ids em 2");
  if (ReadU32(virt, 8) != 7) return Fail("geracao mudou no resyncVirtual 2");
  std::cout << "ok: resyncVirtual reminta e nao toca geracao\n";

  std::cout << "produtor resync: ok\n";
  return 0;
}
