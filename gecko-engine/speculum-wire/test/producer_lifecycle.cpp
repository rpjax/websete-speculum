// Ciclo de vida: DROP no tick do remove, ponteiro reusado não herda id, move no mesmo tick.
#include "speculum/Limits.h"
#include "speculum/Producer.h"

#include <cstdint>
#include <iostream>
#include <memory>
#include <new>
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
  std::vector<FormProp> formProps;
  bool uaOwned = false;
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
    if (child->parent) detach(child);
    parent->children.push_back(child);
    child->parent = parent;
  }
  void insertBefore(FakeNode* parent, FakeNode* child, FakeNode* before) {
    if (child->parent) detach(child);
    std::vector<FakeNode*> next;
    next.reserve(parent->children.size() + 1);
    bool placed = false;
    for (FakeNode* k : parent->children) {
      if (k == before && !placed) {
        next.push_back(child);
        placed = true;
      }
      next.push_back(k);
    }
    if (!placed) next.push_back(child);
    parent->children.swap(next);
    child->parent = parent;
  }
  void detach(FakeNode* child) {
    if (!child->parent) return;
    auto& kids = child->parent->children;
    std::vector<FakeNode*> kept;
    kept.reserve(kids.size());
    for (FakeNode* k : kids) {
      if (k != child) kept.push_back(k);
    }
    kids.swap(kept);
    child->parent = nullptr;
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
  std::vector<FormProp> formPropsOf(const void* n) const override { return at(n)->formProps; }
  bool isUaOwned(const void* n) const override { return at(n)->uaOwned; }
  bool isConnected(const void* n) const override {
    const FakeNode* x = at(n);
    while (x) {
      if (x == document_) return true;
      x = x->parent;
    }
    return false;
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
  FakeNode* html = dom.makeElement("html");
  FakeNode* body = dom.makeElement("body");
  FakeNode* text = dom.makeText("oi");
  dom.setDocument(document);
  dom.append(document, html);
  dom.append(html, body);
  dom.append(body, text);

  Producer p(dom, kContextIdRoot, /*generation=*/1);
  if (p.resyncVirtual(document).empty()) return Fail("boot vazio");
  const size_t baseline = p.table().size();

  // --- churn: insert/remove sem destroy dos filhos. Tabela não cresce. ---
  for (int i = 0; i < 400; ++i) {
    FakeNode* n = dom.makeElement("i");
    FakeNode* t = dom.makeText("x");
    dom.append(n, t);
    dom.append(body, n);
    p.onInserted(body, n);
    auto added = p.emitFrame();
    if (added.empty()) return Fail("churn insert nao emitiu");
    dom.detach(n);
    p.onRemoved(body, n);
    auto dropped = p.emitFrame();
    if (dropped.empty()) return Fail("churn remove nao emitiu");
    if (p.table().size() > baseline + kNodeDropAgeSequences * 3 + 8) {
      return Fail("churn: tabela cresceu sem teto de idade");
    }
  }
  for (uint32_t i = 0; i < kNodeDropAgeSequences + 4; ++i) {
    p.onAttrChanged(body, "data-gc");
    p.emitFrame();
  }
  if (p.table().size() > baseline + 4) return Fail("churn: GC por idade nao limpou");
  std::cout << "ok: churn 400 ciclos, tabela=" << p.table().size() << " identidade=" << p.identity().size()
            << "\n";

  // --- move no mesmo tick: onRemoved + onInserted, id permanece. ---
  FakeNode* mv = dom.makeElement("span");
  dom.append(body, mv);
  p.onInserted(body, mv);
  if (p.emitFrame().empty()) return Fail("span inicial nao emitiu");
  const uint32_t mvId = p.identity().idOf(mv);
  if (mvId == kNone) return Fail("span sem id");
  const size_t afterSpan = p.table().size();
  FakeNode* head = dom.makeElement("head");
  dom.append(html, head);
  p.onInserted(html, head);
  if (p.emitFrame().empty()) return Fail("head nao emitiu");
  dom.append(head, mv);
  p.onRemoved(body, mv);
  p.onInserted(head, mv);
  if (p.emitFrame().empty()) return Fail("move nao emitiu");
  if (p.identity().idOf(mv) != mvId) return Fail("move remintou o id");
  if (p.table().size() != afterSpan + 1) return Fail("move mudou o tamanho da tabela");
  // §5.6: um INSERT, zero REMOVE. CHECK fecha o frame (2 ops).
  if (p.lastEmittedOps() != 2) return Fail("move nao foi um INSERT (REMOVE no mesmo tick)");
  if (p.table().getRow(mvId) == nullptr || p.table().getRow(mvId)->parent == kNone) {
    return Fail("move deixou o no destacado");
  }
  std::cout << "ok: move no mesmo tick preserva id " << mvId << "\n";

  // --- ponteiro reusado: texto sai, elemento nasce no mesmo endereço. ---
  alignas(FakeNode) unsigned char storage[sizeof(FakeNode)];
  FakeNode* recycled = new (storage) FakeNode();
  recycled->kind = NodeKind::Text;
  recycled->value = "velho";
  dom.append(body, recycled);
  p.onInserted(body, recycled);
  if (p.emitFrame().empty()) return Fail("texto reciclavel nao emitiu");
  const uint32_t oldId = p.identity().idOf(recycled);
  if (oldId == kNone) return Fail("texto reciclavel sem id");
  const Row* oldRow = p.table().getRow(oldId);
  if (!oldRow || oldRow->kind != static_cast<uint32_t>(NodeKind::Text)) {
    recycled->~FakeNode();
    return Fail("id velho nao e TEXT");
  }
  dom.detach(recycled);
  p.onRemoved(body, recycled);
  if (p.emitFrame().empty()) return Fail("remove do texto nao emitiu");
  recycled->~FakeNode();
  FakeNode* reincarnated = new (storage) FakeNode();
  reincarnated->kind = NodeKind::Element;
  reincarnated->name = "div";
  dom.append(body, reincarnated);
  p.onInserted(body, reincarnated);
  auto reuseFrame = p.emitFrame();
  if (reuseFrame.empty()) return Fail("reuso nao emitiu");
  const uint32_t newId = p.identity().idOf(reincarnated);
  if (newId == kNone) {
    reincarnated->~FakeNode();
    return Fail("reencarnado sem id");
  }
  if (newId == oldId) {
    reincarnated->~FakeNode();
    return Fail("reuso herdou o id velho");
  }
  const Row* newRow = p.table().getRow(newId);
  if (!newRow || newRow->kind != static_cast<uint32_t>(NodeKind::Element)) {
    reincarnated->~FakeNode();
    return Fail("id novo nao e ELEMENT");
  }
  if (p.table().has(oldId)) {
    reincarnated->~FakeNode();
    return Fail("id velho ainda na tabela");
  }
  reincarnated->~FakeNode();
  std::cout << "ok: ponteiro reusado " << oldId << " -> " << newId << " (TEXT -> ELEMENT)\n";

  // --- TEXT_SET em elemento e no-op. ---
  const uint32_t pending = p.pendingOps();
  p.onTextChanged(html);
  if (p.pendingOps() != pending) return Fail("TEXT_SET em elemento vazou");
  std::cout << "ok: onTextChanged em elemento e no-op\n";

  // --- L24: insert+remove no mesmo tick não emite NODE_NEW. ---
  {
    const size_t rows = p.table().size();
    const size_t ids = p.identity().size();
    FakeNode* eph = dom.makeElement("tmp");
    dom.append(body, eph);
    p.onInserted(body, eph);
    if (p.pendingOps() != 0) return Fail("L24 sujou o builder no onInserted");
    dom.detach(eph);
    p.onRemoved(body, eph);
    auto f = p.emitFrame();
    if (!f.empty()) return Fail("L24 emitiu frame para no efemero");
    if (p.table().size() != rows) return Fail("L24 tabela mudou");
    if (p.identity().size() != ids) return Fail("L24 identidade vazou");
  }
  std::cout << "ok: L24 efemero do tick nao vai ao fio\n";

  // --- dois inserts no mesmo tick: beforeId só de linha já na tabela. ---
  {
    FakeNode* one = dom.makeElement("one");
    FakeNode* two = dom.makeElement("two");
    dom.append(body, one);
    dom.append(body, two);
    p.onInserted(body, one);
    p.onInserted(body, two);
    if (p.emitFrame().empty()) return Fail("dois inserts nao emitiram");
    const uint32_t bodyId = p.identity().idOf(body);
    const uint32_t oneId = p.identity().idOf(one);
    const uint32_t twoId = p.identity().idOf(two);
    auto kids = p.table().orderedChildIds(bodyId);
    if (kids.size() < 2) return Fail("dois inserts: filhos de menos");
    if (kids[kids.size() - 2] != oneId || kids[kids.size() - 1] != twoId) {
      return Fail("dois inserts: ordem one,two quebrada");
    }
  }
  std::cout << "ok: dois inserts no mesmo tick na ordem do DOM\n";

  // --- P7+P16: dois irmãos no meio da lista, uma âncora, um INSERT. ---
  {
    FakeNode* first = dom.makeElement("first-mid");
    FakeNode* last = dom.makeElement("last-mid");
    dom.append(body, first);
    p.onInserted(body, first);
    if (p.emitFrame().empty()) return Fail("first-mid nao emitiu");
    dom.append(body, last);
    p.onInserted(body, last);
    if (p.emitFrame().empty()) return Fail("last-mid nao emitiu");
    FakeNode* m1 = dom.makeElement("m1");
    FakeNode* m2 = dom.makeElement("m2");
    dom.insertBefore(body, m1, last);
    dom.insertBefore(body, m2, last);
    p.onInserted(body, m1);
    p.onInserted(body, m2);
    if (p.emitFrame().empty()) return Fail("meio da lista nao emitiu");
    const uint32_t firstId = p.identity().idOf(first);
    const uint32_t m1Id = p.identity().idOf(m1);
    const uint32_t m2Id = p.identity().idOf(m2);
    const uint32_t lastId = p.identity().idOf(last);
    auto kids = p.table().orderedChildIds(p.identity().idOf(body));
    bool saw = false;
    for (size_t i = 0; i + 3 < kids.size(); ++i) {
      if (kids[i] == firstId && kids[i + 1] == m1Id && kids[i + 2] == m2Id &&
          kids[i + 3] == lastId) {
        saw = true;
        break;
      }
    }
    if (!saw) return Fail("meio da lista: ordem first,m1,m2,last quebrada");
    if (p.lastInsertOpCount() != 1) return Fail("meio da lista: INSERT nao foi um lote");
    if (p.lastInsertIdCount() != 2) return Fail("meio da lista: ids do lote");
  }
  std::cout << "ok: INSERT em lote no meio da lista\n";

  // --- L24: filho novo some com o pai no mesmo tick. ---
  {
    FakeNode* wrap = dom.makeElement("wrap");
    dom.append(body, wrap);
    p.onInserted(body, wrap);
    if (p.emitFrame().empty()) return Fail("wrap inicial nao emitiu");
    const size_t rows = p.table().size();
    const size_t ids = p.identity().size();
    FakeNode* inner = dom.makeElement("inner");
    dom.append(wrap, inner);
    p.onInserted(wrap, inner);
    dom.detach(wrap);
    p.onRemoved(body, wrap);
    auto f = p.emitFrame();
    if (f.empty()) return Fail("remove do wrap nao emitiu");
    if (p.identity().idOf(inner) != kNone) return Fail("L24 filho vazou no mapa");
    const uint32_t wrapId = p.identity().idOf(wrap);
    if (wrapId == kNone) return Fail("L24 wrap perdeu id");
    const Row* wrapRow = p.table().getRow(wrapId);
    if (!wrapRow) return Fail("L24 wrap saiu da tabela no mesmo tick");
    if (wrapRow->parent != kNone) return Fail("L24 wrap nao destacou");
    if (p.table().size() != rows) return Fail("L24 tamanho da tabela mudou");
    if (p.identity().size() != ids) return Fail("L24 identidade do wrap sumiu");
  }
  std::cout << "ok: L24 filho do tick nao viaja com o pai\n";

  // --- UA nao entra na tabela. ---
  {
    const size_t rows = p.table().size();
    FakeNode* ua = dom.makeElement("inner-ua");
    ua->uaOwned = true;
    dom.append(body, ua);
    p.onInserted(body, ua);
    auto f = p.emitFrame();
    if (!f.empty()) return Fail("UA emitiu frame");
    if (p.table().size() != rows) return Fail("UA entrou na tabela");
    if (p.identity().idOf(ua) != kNone) return Fail("UA ganhou id");
  }
  std::cout << "ok: UA nao e projetado\n";

  // --- Halt nao descarta a fila; Flush emite. ---
  {
    const uint64_t hashBefore = p.table().tableHash();
    p.setHalted(true);
    FakeNode* parked = dom.makeElement("parked");
    dom.append(body, parked);
    p.onInserted(body, parked);
    auto dumpHalted = p.snapshotDump();
    if (dumpHalted.size() < 28) return Fail("snapshot curto");
    uint64_t hashDump = 0;
    for (int i = 0; i < 8; ++i) hashDump |= uint64_t(dumpHalted[12 + i]) << (8 * i);
    if (hashDump != hashBefore) return Fail("halt mudou tableHash sem Flush");
    if (p.table().size() == 0) return Fail("halt zerou tabela");
    auto flushed = p.emitFrame();
    if (flushed.empty()) return Fail("Flush em halt nao emitiu");
    if (p.table().tableHash() == hashBefore) return Fail("Flush nao aplicou a fila");
    p.setHalted(false);
  }
  std::cout << "ok: Halt != discardPending; Flush emite\n";

  // --- PROP amostrado no drain, nao no registro. ---
  {
    body->formProps = {FormProp{0x01, PropValue::str("campo-vivo")}};
    auto f = p.emitFrame();
    if (f.empty()) return Fail("PROP no tick nao emitiu");
    const PropValue* got = p.table().getProp(p.identity().idOf(body), 0x01);
    if (!got || got->strValue != "campo-vivo") return Fail("PROP nao chegou na tabela");
  }
  std::cout << "ok: PROP amostrado no drain\n";

  // --- Pai + filho no mesmo tick: onInserted reserva id do filho antes do NODE_NEW.
  // describeAndInsertChildren do pai NÃO pode INSERT sem NODE_NEW (§5.5 / Beleza criteo). ---
  {
    FakeNode* wrap = dom.makeElement("wrap-same-tick");
    FakeNode* inner = dom.makeElement("inner-same-tick");
    FakeNode* leaf = dom.makeText("leaf-same-tick");
    dom.append(inner, leaf);
    dom.append(wrap, inner);
    dom.append(body, wrap);
    p.onInserted(body, wrap);
    p.onInserted(wrap, inner);
    p.onInserted(inner, leaf);
    auto f = p.emitFrame();
    if (f.empty()) return Fail("pai+filho mesmo tick nao emitiu");
    const uint32_t wrapId = p.identity().idOf(wrap);
    const uint32_t innerId = p.identity().idOf(inner);
    const uint32_t leafId = p.identity().idOf(leaf);
    if (wrapId == kNone || innerId == kNone || leafId == kNone) {
      return Fail("pai+filho mesmo tick sem id");
    }
    if (!p.table().getRow(wrapId) || !p.table().getRow(innerId) || !p.table().getRow(leafId)) {
      return Fail("pai+filho mesmo tick sem linha (NODE_NEW faltou)");
    }
    auto kids = p.table().orderedChildIds(wrapId);
    if (kids.size() != 1 || kids[0] != innerId) return Fail("wrap sem inner na tabela");
    auto innerKids = p.table().orderedChildIds(innerId);
    if (innerKids.size() != 1 || innerKids[0] != leafId) return Fail("inner sem leaf na tabela");
    if (p.lastInsertIdCount() != 3) return Fail("pai+filho mesmo tick INSERT duplicado");
  }
  std::cout << "ok: pai+filho mesmo tick NODE_NEW antes de INSERT\n";

  // --- P4: 1000 ATTR no mesmo nome = 1 op. ---
  {
    const uint32_t pending = p.pendingOps();
    for (int i = 0; i < 1000; ++i) p.onAttrChanged(body, "class");
    if (p.pendingOps() != pending) return Fail("ATTR sujou o builder no callback");
    body->attrs.push_back(AttrPair{"class", "x"});
    auto f = p.emitFrame();
    if (f.empty()) return Fail("ATTR drain nao emitiu");
    if (p.lastEmittedOps() != 2) return Fail("ATTR nao coalesceu (1 SET + CHECK)");
  }
  std::cout << "ok: ATTR coalescido no drain\n";

  // --- P11: destaque + reinsert no tick seguinte reusa o id. ---
  {
    FakeNode* park = dom.makeElement("park");
    dom.append(body, park);
    p.onInserted(body, park);
    if (p.emitFrame().empty()) return Fail("park insert nao emitiu");
    const uint32_t parkId = p.identity().idOf(park);
    dom.detach(park);
    p.onRemoved(body, park);
    if (p.emitFrame().empty()) return Fail("park remove nao emitiu");
    if (!p.table().has(parkId)) return Fail("park DROP no mesmo tick");
    dom.append(body, park);
    p.onInserted(body, park);
    if (p.emitFrame().empty()) return Fail("park reinsert nao emitiu");
    if (p.identity().idOf(park) != parkId) return Fail("park nao reusou o id");
  }
  std::cout << "ok: destaque+reattach no tick seguinte reusa id\n";

  std::cout << "produtor lifecycle: ok\n";
  return 0;
}
