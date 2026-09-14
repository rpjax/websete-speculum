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
  // Host de contexto aninhado (iframe / frame / object / embed). Sem C ainda:
  // o produtor segura o NODE_NEW. Fonte do C é o runtime, não este mapa.
  virtual bool isNestedHost(const void* /*node*/) const { return false; }
  virtual uint32_t childScopeIdOf(const void* /*node*/) const { return 0; }
  // Passo 1 de emitResyncFrame: id cujo nó não está mais ligado some do mapa, sem NODE_DROP.
  virtual bool isConnected(const void* /*node*/) const { return true; }
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
  uint32_t generation() const { return generation_; }

  // Halt do tick: ops não emitidas caem. O resync descreve o DOM vivo.
  void discardPending() { builder_.begin(); }

  // §5.8 resyncVirtual: zera o mapa (geração intacta), aloca o que está ligado, emite
  // o frame de resync. Attach do documento é isto — não um caminho paralelo.
  std::vector<uint8_t> resyncVirtual(const void* documentNode) {
    ids_.clear();
    pendingHosts_.clear();
    documentNode_ = documentNode;
    discardPending();
    allocateConnected(documentNode);
    return emitResyncFrame();
  }

  // §5.8 emitResyncFrame: duas passagens no mapa, tabela reconstruída, flag de resync.
  // preTableHash viaja 0 — o cliente não tem estado prévio a conferir (wholesale replace).
  std::vector<uint8_t> emitResyncFrame() {
    discardPending();
    adoptReadyPendingHosts();

    const uint32_t seq = sequence_ + 1;
    table_.reset();
    table_.setSequence(seq);
    builder_.begin();

    const std::vector<uint32_t> snapshot = ids_.allIds();
    std::vector<uint32_t> drop;
    std::vector<uint32_t> live;
    drop.reserve(snapshot.size());
    live.reserve(snapshot.size());
    for (uint32_t id : snapshot) {
      const void* key = ids_.keyOf(id);
      if (!key || !source_.isConnected(key) || source_.isUaOwned(key) ||
          awaitingChildScope(key)) {
        drop.push_back(id);
        continue;
      }
      live.push_back(id);
      emitNodeNew(key, id);
    }
    for (uint32_t id : drop) ids_.releaseId(id);

    insertLiveChildren(documentNode_, kDocumentId);
    for (uint32_t id : live) {
      const void* key = ids_.keyOf(id);
      if (!key) continue;
      insertLiveChildren(key, id);
    }

    builder_.check(kCheckScopeTable, 0, 0, table_.tableHash());

    PartHeader h;
    h.contextId = contextId_;
    h.generation = generation_;
    h.sequence = seq;
    h.flags = kFrameFlagResync;
    h.preTableHash = 0;
    auto bytes = builder_.finish(h);

    sequence_ = seq;
    preTableHash_ = table_.tableHash();
    builder_.begin();
    table_.setSequence(sequence_ + 1);
    return bytes;
  }

  // ---- registros do motor ----

  void onInserted(const void* parent, const void* node) {
    if (source_.isUaOwned(node)) return;
    if (awaitingChildScope(node)) {
      pendingHosts_.push_back(PendingHost{parent, node});
      return;
    }
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

  // ---- frame ordinário ----

  // Fecha o frame com CHECK(scope=Table) sobre o tableHash. preTableHash é o hash da
  // tabela no começo deste tick (depois do emit anterior), não o hash já mutado.
  // Devolve vazio quando não houve op: frame vazio não é emitido e não consome `sequence`.
  std::vector<uint8_t> emitFrame() {
    flushPendingHosts();
    if (builder_.opCount() == 0) return {};
    const uint64_t pre = preTableHash_;
    builder_.check(kCheckScopeTable, 0, 0, table_.tableHash());

    PartHeader h;
    h.contextId = contextId_;
    h.generation = generation_;
    h.sequence = ++sequence_;
    h.flags = 0;
    h.preTableHash = pre;
    auto bytes = builder_.finish(h);

    preTableHash_ = table_.tableHash();
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

  bool awaitingChildScope(const void* node) const {
    return source_.isNestedHost(node) && source_.childScopeIdOf(node) < 2;
  }

  void notePendingHost(const void* parent, const void* node) {
    for (const auto& pending : pendingHosts_) {
      if (pending.node == node) return;
    }
    pendingHosts_.push_back(PendingHost{parent, node});
  }

  void adoptReadyPendingHosts() {
    std::vector<PendingHost> still;
    still.reserve(pendingHosts_.size());
    for (const auto& pending : pendingHosts_) {
      if (awaitingChildScope(pending.node)) {
        still.push_back(pending);
        continue;
      }
      ids_.assign(pending.node);
    }
    pendingHosts_.swap(still);
  }

  void flushPendingHosts() {
    std::vector<PendingHost> still;
    still.reserve(pendingHosts_.size());
    for (const auto& pending : pendingHosts_) {
      if (awaitingChildScope(pending.node)) {
        still.push_back(pending);
        continue;
      }
      uint32_t parentId = idFor(pending.parent);
      if (parentId == kNone) continue;
      uint32_t before = beforeIdOf(pending.parent, pending.node);
      ensureDescribed(pending.node);
      builder_.insert(parentId, before, {ids_.idOf(pending.node)});
      table_.insertBatch(parentId, before, {ids_.idOf(pending.node)});
    }
    pendingHosts_.swap(still);
  }

  void allocateConnected(const void* node) {
    if (node != documentNode_) {
      if (source_.isUaOwned(node) || awaitingChildScope(node)) return;
      ids_.assign(node);
    }
    for (const void* child : source_.childrenOf(node)) {
      if (source_.isUaOwned(child)) continue;
      if (awaitingChildScope(child)) {
        notePendingHost(node, child);
        continue;
      }
      allocateConnected(child);
    }
  }

  void emitNodeNew(const void* node, uint32_t id) {
    const NodeKind kind = source_.kindOf(node);
    switch (kind) {
      case NodeKind::Element: {
        const auto ns = source_.nsOf(node);
        const auto name = source_.nameOf(node);
        const auto attrs = source_.attrsOf(node);
        const auto uri = ns == ElementNs::Custom ? source_.uriOf(node) : std::string();
        const bool nestedHost = source_.isNestedHost(node);
        const uint32_t childScope = nestedHost ? source_.childScopeIdOf(node) : 0;
        builder_.nodeNewElement(id, ns, name, attrs, uri, nestedHost, childScope);
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
        break;
    }
  }

  void describe(const void* node) {
    emitNodeNew(node, ids_.assign(node));
  }

  void insertLiveChildren(const void* parent, uint32_t parentId) {
    if (!parent || parentId == kNone) return;
    std::vector<uint32_t> batch;
    for (const void* child : source_.childrenOf(parent)) {
      if (source_.isUaOwned(child)) continue;
      if (awaitingChildScope(child)) {
        notePendingHost(parent, child);
        continue;
      }
      uint32_t id = ids_.idOf(child);
      if (id == kNone) continue;
      batch.push_back(id);
    }
    if (batch.empty()) return;
    builder_.insert(parentId, kInsertAtEnd, batch);
    table_.insertBatch(parentId, kInsertAtEnd, batch);
  }

  void describeAndInsertChildren(const void* parent, uint32_t parentId) {
    std::vector<uint32_t> batch;
    for (const void* child : source_.childrenOf(parent)) {
      if (source_.isUaOwned(child)) continue;
      if (awaitingChildScope(child)) {
        notePendingHost(parent, child);
        continue;
      }
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

  struct PendingHost {
    const void* parent;
    const void* node;
  };

  NodeSource& source_;
  IdentityMap ids_;
  ReplicatedTable table_;
  FramePartBuilder builder_;
  std::vector<PendingHost> pendingHosts_;
  const void* documentNode_ = nullptr;
  uint32_t contextId_;
  uint32_t generation_;
  uint32_t sequence_ = 0;
  uint64_t preTableHash_ = 0;
};

}  // namespace speculum
