// Laco completo do produtor, com um DOM falso: registro -> op -> tabela -> hash -> frame.
#include <algorithm>
// Os frames sao gravados em disco; o lado TS aplica cada um com applyFrameToTableChecked
// (o apply ESTRITO do cliente, que valida precondicao e confere o CHECK) e compara o
// tableHash final com o do produtor.
#include "speculum/Producer.h"

#include <fstream>
#include <iostream>
#include <map>
#include <memory>

using namespace speculum;

// ---- DOM falso ----
struct FakeNode {
  NodeKind kind = NodeKind::Element;
  ElementNs ns = ElementNs::Html;
  std::string uri;
  std::string name;
  std::string value;
  std::vector<AttrPair> attrs;
  std::vector<FakeNode*> children;
  FakeNode* parent = nullptr;
  bool uaOwned = false;
};

class FakeDom : public NodeSource {
 public:
  FakeNode* makeElement(const std::string& tag, std::vector<AttrPair> attrs = {},
                        ElementNs ns = ElementNs::Html, std::string uri = "") {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Element;
    n->ns = ns;
    n->uri = std::move(uri);
    n->name = tag;
    n->attrs = std::move(attrs);
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
  FakeNode* makeComment(const std::string& v) {
    auto n = std::make_unique<FakeNode>();
    n->kind = NodeKind::Comment;
    n->value = v;
    FakeNode* raw = n.get();
    owned_.push_back(std::move(n));
    return raw;
  }

  void append(FakeNode* parent, FakeNode* child) { insertBefore(parent, child, nullptr); }

  void insertBefore(FakeNode* parent, FakeNode* child, FakeNode* before) {
    if (child->parent) detach(child);
    auto& kids = parent->children;
    auto at = before ? std::find(kids.begin(), kids.end(), before) : kids.end();
    kids.insert(at, child);
    child->parent = parent;
  }

  void detach(FakeNode* child) {
    if (!child->parent) return;
    auto& kids = child->parent->children;
    kids.erase(std::remove(kids.begin(), kids.end(), child), kids.end());
    child->parent = nullptr;
  }

  void setAttr(FakeNode* n, const std::string& name, const std::string& value) {
    for (auto& a : n->attrs) {
      if (a.name == name) {
        a.value = value;
        return;
      }
    }
    n->attrs.push_back(AttrPair{name, value});
  }

  void removeAttr(FakeNode* n, const std::string& name) {
    auto& a = n->attrs;
    a.erase(std::remove_if(a.begin(), a.end(),
                           [&](const AttrPair& p) { return p.name == name; }),
            a.end());
  }

  // NodeSource
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
  bool isUaOwned(const void* n) const override { return at(n)->uaOwned; }
  bool isConnected(const void* n) const override {
    return at(n)->parent != nullptr || n == document_;
  }
  void setDocument(FakeNode* n) { document_ = n; }

 private:
  static const FakeNode* at(const void* n) { return static_cast<const FakeNode*>(n); }
  std::vector<std::unique_ptr<FakeNode>> owned_;
  FakeNode* document_ = nullptr;
};

int main(int argc, char** argv) {
  const std::string outDir = argc > 1 ? argv[1] : "/tmp/speculum-wire";

  FakeDom dom;
  FakeNode* document = dom.makeElement("#document");
  dom.setDocument(document);

  Producer p(dom, kContextIdRoot, /*generation=*/3);

  // --- carga inicial: <html><head></head><body class=app>texto</body></html> ---
  FakeNode* html = dom.makeElement("html", {{"lang", "pt-BR"}});
  FakeNode* head = dom.makeElement("head");
  FakeNode* body = dom.makeElement("body", {{"class", "app"}});
  FakeNode* t1 = dom.makeText("texto inicial");
  dom.append(document, html);
  dom.append(html, head);
  dom.append(html, body);
  dom.append(body, t1);

  // controles de UA pendurados no body — nao devem ser projetados (item F)
  FakeNode* uaThumb = dom.makeElement("#ua-thumb");
  uaThumb->uaOwned = true;
  dom.append(body, uaThumb);

  std::vector<std::vector<uint8_t>> frames;
  auto boot = p.resyncVirtual(document);
  if (boot.empty()) {
    std::cerr << "FALHOU: resyncVirtual nao emitiu\n";
    return 1;
  }
  frames.push_back(boot);
  std::cout << "frame 1 (resyncVirtual): " << boot.size()
            << " bytes, tableHash=" << p.table().tableHash() << "\n";

  auto flush = [&](const char* what) {
    auto f = p.emitFrame();
    if (!f.empty()) {
      frames.push_back(f);
      std::cout << "frame " << frames.size() << " (" << what << "): " << f.size()
                << " bytes, tableHash=" << p.table().tableHash() << "\n";
    }
  };

  // --- mutacoes ---
  FakeNode* d1 = dom.makeElement("div", {{"id", "a"}});
  FakeNode* d2 = dom.makeElement("div", {{"id", "b"}});
  dom.append(body, d1);
  p.onInserted(body, d1);
  dom.append(body, d2);
  p.onInserted(body, d2);
  flush("dois divs");

  // insercao no meio: before = irmao seguinte
  FakeNode* span = dom.makeElement("span");
  FakeNode* inner = dom.makeText("dentro do span");
  dom.append(span, inner);
  dom.insertBefore(body, span, d2);
  p.onInserted(body, span);  // descreve a subarvore e liga antes de d2
  flush("span com filho, no meio");

  // atributos
  dom.setAttr(d1, "class", "azul");
  p.onAttrChanged(d1, "class");
  dom.removeAttr(d1, "id");
  p.onAttrChanged(d1, "id");
  // texto
  t1->value = "texto trocado";
  p.onTextChanged(t1);
  // propriedade
  p.onPropChanged(body, 0x01, PropValue::str("campo"));
  p.onPropChanged(body, 0x02, PropValue::boolean(true));
  flush("conteudo");

  // mover no ja ligado para outro pai
  dom.append(head, d2);
  p.onInserted(head, d2);
  flush("mover d2 para head");

  // remover e derrubar
  dom.detach(span);
  p.onRemoved(body, span);
  flush("remover span");
  p.onDestroyed(span);  // raiz destacada -> NODE_DROP leva o filho junto
  flush("drop do span");

  // comentario, e um no de UA que continua invisivel
  FakeNode* cm = dom.makeComment(" nota ");
  dom.append(body, cm);
  p.onInserted(body, cm);
  FakeNode* uaExtra = dom.makeElement("#ua-track");
  uaExtra->uaOwned = true;
  dom.append(body, uaExtra);
  p.onInserted(body, uaExtra);  // ignorado de proposito
  flush("comentario + no de UA ignorado");

  // --- grava ---
  std::ofstream idx(outDir + "/frames.txt");
  for (size_t i = 0; i < frames.size(); ++i) {
    const std::string path = outDir + "/frame_" + std::to_string(i) + ".bin";
    std::ofstream f(path, std::ios::binary);
    f.write(reinterpret_cast<const char*>(frames[i].data()),
            static_cast<std::streamsize>(frames[i].size()));
    idx << "frame_" << i << ".bin\n";
  }
  std::ofstream summary(outDir + "/producer_cpp.json");
  summary << "{\n  \"frames\": " << frames.size() << ",\n  \"rows\": " << p.table().size()
          << ",\n  \"tableHash\": \"" << p.table().tableHash() << "\",\n  \"identitySize\": "
          << p.identity().size() << "\n}\n";

  std::cout << "produtor: " << frames.size() << " frames, " << p.table().size()
            << " linhas, tableHash=" << p.table().tableHash() << "\n";
  return 0;
}
