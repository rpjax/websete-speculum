// Speculum — o produtor: registro do motor -> op -> aplica na NOSSA tabela -> atualiza hash
// -> emite. Essa é a ordem, e ela não se simplifica: o hash por frame existe porque a tabela
// do produtor e a do cliente têm que concordar dentro da mesma execução.
//
// Esta camada é pura. Ela lê a árvore viva por uma interface (`NodeSource`) que o lado do
// motor implementa — no Gecko, sobre `nsINode`. Assim o algoritmo do produtor é testável
// fora da árvore do Gecko, e o que sobra lá dentro é cola.
#pragma once
#include "speculum/Identity.h"
#include "speculum/Table.h"
#include "speculum/Wire.h"

#include <string>
#include <vector>

namespace speculum {

// Leitura da árvore viva. Implementada pelo lado do motor; o produtor nunca toca no DOM.
class NodeSource {
 public:
  virtual ~NodeSource() = default;
  virtual NodeKind kindOf(const void* node) const = 0;
  virtual ElementNs nsOf(const void* node) const = 0;
  virtual std::string uriOf(const void* node) const = 0;   // só quando ns == Custom
  virtual std::string nameOf(const void* node) const = 0;  // tag, ou nome do doctype
  virtual std::string valueOf(const void* node) const = 0; // texto / comentário
  virtual std::vector<AttrPair> attrsOf(const void* node) const = 0;
  virtual std::vector<const void*> childrenOf(const void* node) const = 0;
  // `true` quando o nó é do UA, não do autor (item F): o elemento é o contrato, o interior
  // é trabalho do navegador — dos dois lados. Nada criado pelo navegador é projetado.
  virtual bool isUaOwned(const void* /*node*/) const { return false; }
};

class Producer {
 public:
  Producer(NodeSource& source, uint32_t contextId = kContextIdRoot, uint32_t generation = 0)
      : source_(source), contextId_(contextId), generation_(generation) {
    builder_.begin();
  }

  const ReplicatedTable& table() const { return table_; }
  const IdentityMap& identity() const { return ids_; }
  uint32_t sequence() const { return sequence_; }
  uint32_t pendingOps() const { return builder_.opCount(); }

  // O Document é a linha 1 implícita: nunca descrito, nunca com rowHash próprio.
  // Descreve tudo que já está pendurado nele.
  void bootstrap(const void* documentNode) {
    documentNode_ = documentNode;
    table_.setSequence(sequence_);
    describeAndInsertChildren(documentNode, kDocumentId);
  }

  // ---- registros do motor ----

  void onInserted(const void* parent, const void* node) {
    if (source_.isUaOwned(node)) return;
    uint32_t parentId = idFor(parent);
    if (parentId == kNone) return;  // pai fora da projeção: nada a dizer
    uint32_t before = beforeIdOf(parent, node);
    ensureDescribed(node);
    builder_.insert(parentId, before, {ids_.idOf(node)});
    table_.insertBatch(parentId, before, {ids_.idOf(node)});
  }

  void onRemoved(const void* parent, const void* node) {
    uint32_t id = ids_.idOf(node);
    if (id == kNone) return;
    uint32_t parentId = idFor(parent);
    builder_.remove(parentId, {id});
    table_.removeBatch(parentId, {id});
  }

  void onAttrChanged(const void* node, const std::string& name) {
    uint32_t id = ids_.idOf(node);
    if (id == kNone) return;
    for (const auto& a : source_.attrsOf(node)) {
      if (a.name != name) continue;
      builder_.attrSet(id, {a});
      table_.setAttrs(id, {a});
      return;
    }
    // Não está mais na lista viva: foi removido.
    builder_.attrDel(id, {name});
    table_.delAttrs(id, {name});
  }

  void onTextChanged(const void* node) {
    uint32_t id = ids_.idOf(node);
    if (id == kNone) return;
    const std::string v = source_.valueOf(node);
    builder_.textSet(id, v);
    table_.setValue(id, v);
  }

  void onPropChanged(const void* node, uint8_t propId, const PropValue& value) {
    uint32_t id = ids_.idOf(node);
    if (id == kNone) return;
    if (value.isBool) {
      builder_.propSetBool(id, propId, value.boolValue);
    } else {
      builder_.propSetStr(id, propId, value.strValue);
    }
    table_.setProp(id, propId, value);
  }

  // O motor avisa antes do nó morrer. Só se derruba raiz destacada: linha ligada tem que ser
  // removida antes (§4.2, e o apply estrito do cliente recusa o contrário).
  void onDestroyed(const void* node) {
    uint32_t id = ids_.release(node);
    if (id == kNone) return;
    const Row* row = table_.getRow(id);
    if (!row) return;
    if (row->parent != kNone) return;  // ainda ligada: quem remove emite REMOVE antes
    builder_.nodeDrop({id});
    for (uint32_t dropped : table_.dropSubtree(id)) ids_.releaseId(dropped);
  }

  // ---- frame ----

  // Fecha o frame com CHECK(scope=Table) sobre o tableHash — é isso que deixa o cliente
  // recusar uma réplica divergente em vez de seguir aplicando em cima de estado errado.
  // Devolve vazio quando não houve op: frame vazio não é emitido e não consome `sequence`.
  std::vector<uint8_t> emitFrame(bool resync = false) {
    if (builder_.opCount() == 0) return {};
    builder_.check(kCheckScopeTable, 0, 0, table_.tableHash());

    PartHeader h;
    h.contextId = contextId_;
    h.generation = generation_;
    h.sequence = ++sequence_;
    h.flags = resync ? kFrameFlagResync : 0;
    h.preTableHash = 0;  // v0: não conferido no fio (igual ao produtor TS)
    auto bytes = builder_.finish(h);

    builder_.begin();
    table_.setSequence(sequence_ + 1);
    return bytes;
  }

 private:
  uint32_t idFor(const void* node) const {
    if (node == documentNode_) return kDocumentId;
    return ids_.idOf(node);
  }

  // Id do irmão seguinte já projetado, ou 0 para "insere no fim".
  uint32_t beforeIdOf(const void* parent, const void* node) const {
    const auto kids = source_.childrenOf(parent);
    bool found = false;
    for (const void* k : kids) {
      if (k == node) {
        found = true;
        continue;
      }
      if (!found) continue;
      uint32_t id = ids_.idOf(k);
      if (id != kNone) return id;
    }
    return kInsertAtEnd;
  }

  void ensureDescribed(const void* node) {
    if (ids_.known(node)) return;
    describe(node);
    describeAndInsertChildren(node, ids_.idOf(node));
  }

  // NODE_NEW sempre cria linha destacada; a topologia vem por INSERT.
  void describe(const void* node) {
    const uint32_t id = ids_.assign(node);
    const NodeKind kind = source_.kindOf(node);
    switch (kind) {
      case NodeKind::Element: {
        const auto ns = source_.nsOf(node);
        const auto name = source_.nameOf(node);
        const auto attrs = source_.attrsOf(node);
        const auto uri = ns == ElementNs::Custom ? source_.uriOf(node) : std::string();
        builder_.nodeNewElement(id, ns, name, attrs, uri);
        table_.createElementRow(id, name, attrs, ns, uri);
        break;
      }
      case NodeKind::Text: {
        const auto v = source_.valueOf(node);
        builder_.nodeNewText(id, v);
        table_.createLeafRow(id, NodeKind::Text, v);
        break;
      }
      case NodeKind::Comment: {
        const auto v = source_.valueOf(node);
        builder_.nodeNewComment(id, v);
        table_.createLeafRow(id, NodeKind::Comment, v);
        break;
      }
      case NodeKind::Doctype: {
        const auto n = source_.nameOf(node);
        builder_.nodeNewDoctype(id, n);
        table_.createLeafRow(id, NodeKind::Doctype, n);
        break;
      }
      default:
        // Shadow root entra por caminho próprio (admissão), não por este.
        break;
    }
  }

  void describeAndInsertChildren(const void* parent, uint32_t parentId) {
    std::vector<uint32_t> batch;
    for (const void* child : source_.childrenOf(parent)) {
      if (source_.isUaOwned(child)) continue;
      if (!ids_.known(child)) {
        describe(child);
        describeAndInsertChildren(child, ids_.idOf(child));
      }
      batch.push_back(ids_.idOf(child));
    }
    if (batch.empty()) return;
    builder_.insert(parentId, kInsertAtEnd, batch);
    table_.insertBatch(parentId, kInsertAtEnd, batch);
  }

  NodeSource& source_;
  IdentityMap ids_;
  ReplicatedTable table_;
  FramePartBuilder builder_;
  const void* documentNode_ = nullptr;
  uint32_t contextId_;
  uint32_t generation_;
  uint32_t sequence_ = 0;
};

}  // namespace speculum
