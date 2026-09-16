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

#include <algorithm>
#include <string>
#include <vector>

namespace speculum {

struct FormProp {
  uint8_t id = 0;
  PropValue value;
};

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

  virtual const void* shadowRootOf(const void* /*host*/) const { return nullptr; }
  virtual const void* shadowHostOf(const void* /*shadowRoot*/) const { return nullptr; }
  virtual uint8_t shadowModeOf(const void* /*shadowRoot*/) const { return 0; }
  virtual std::vector<FormProp> formPropsOf(const void* /*node*/) const { return {}; }
  virtual std::vector<const void*> cssomSheets() const { return {}; }
  virtual std::vector<const void*> cssomRulesOf(const void* /*sheet*/) const { return {}; }
  virtual std::string cssomRuleTextOf(const void* /*rule*/) const { return {}; }
  virtual const void* cssomSheetOf(const void* /*rule*/) const { return nullptr; }
  // Live CSSOM set — not "this pointer was a sheet once". emitResyncFrame drops
  // Sheet/Rule ids that fail these, without casting the pointer to nsINode.
  virtual bool isSheet(const void* /*ptr*/) const { return false; }
  virtual bool isRule(const void* /*ptr*/) const { return false; }
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
  uint32_t lastFrameNewNodes() const { return lastFrameNewNodes_; }
  uint32_t lastEmittedOps() const { return lastEmittedOps_; }
  bool halted() const { return halted_; }

  // Halt para o relógio. A fila continua; Flush chama emitFrame. Não é discard.
  void setHalted(bool halted) { halted_ = halted; }

  // Halt do tick: ops não emitidas caem. O resync descreve o DOM vivo.
  void discardPending() {
    builder_.begin();
    pendingInserts_.clear();
    pendingSheets_.clear();
    pendingRules_.clear();
  }

  // §5.8 resyncVirtual: zera o mapa (geração intacta), aloca o que está ligado, emite
  // o frame de resync. Attach do documento é isto — não um caminho paralelo.
  std::vector<uint8_t> resyncVirtual(const void* documentNode) {
    ids_.clear();
    pendingHosts_.clear();
    pendingDrop_.clear();
    pendingInserts_.clear();
    documentNode_ = documentNode;
    discardPending();
    allocateConnected(documentNode);
    allocateCssom();
    return emitResyncFrame();
  }

  // §5.8 emitResyncFrame: duas passagens no mapa, tabela reconstruída, flag de resync.
  // preTableHash viaja 0 — o cliente não tem estado prévio a conferir (wholesale replace).
  std::vector<uint8_t> emitResyncFrame() {
    discardPending();
    adoptReadyPendingHosts();
    // Force 0 (mapa intacto) também precisa das sheets vivas que o source
    // acabou de capturar — senão só entra o que já passou por onSheetAdded.
    allocateCssom();

    const uint32_t seq = sequence_ + 1;
    table_.reset();
    table_.setSequence(seq);
    builder_.begin();

    const std::vector<uint32_t> snapshot = ids_.allIds();
    std::vector<uint32_t> drop;
    std::vector<uint32_t> live;
    std::vector<uint32_t> sheets;
    std::vector<uint32_t> rules;
    drop.reserve(snapshot.size());
    live.reserve(snapshot.size());
    sheets.reserve(snapshot.size());
    rules.reserve(snapshot.size());
    for (uint32_t id : snapshot) {
      const IdentityKey key = ids_.keyOf(id);
      if (!key.ptr) {
        drop.push_back(id);
        continue;
      }
      if (key.space == KeySpace::Sheet) {
        if (!source_.isSheet(key.ptr)) {
          drop.push_back(id);
          continue;
        }
        live.push_back(id);
        sheets.push_back(id);
        continue;
      }
      if (key.space == KeySpace::Rule) {
        if (!source_.isRule(key.ptr)) {
          drop.push_back(id);
          continue;
        }
        live.push_back(id);
        rules.push_back(id);
        continue;
      }
      if (!source_.isConnected(key.ptr) || source_.isUaOwned(key.ptr) ||
          awaitingChildScope(key.ptr)) {
        drop.push_back(id);
        continue;
      }
      live.push_back(id);
      emitNodeNew(key.ptr, id);
    }
    for (uint32_t id : drop) ids_.releaseId(id);
    for (uint32_t id : sheets) {
      const IdentityKey key = ids_.keyOf(id);
      if (key.ptr) emitSheetNew(key.ptr, id);
    }
    for (uint32_t id : rules) {
      const IdentityKey key = ids_.keyOf(id);
      if (!key.ptr) continue;
      emitRuleNew(source_.cssomSheetOf(key.ptr), key.ptr, id);
    }

    insertLiveChildren(documentNode_, kDocumentId);
    for (uint32_t id : live) {
      const IdentityKey key = ids_.keyOf(id);
      if (!key.ptr || key.space != KeySpace::Node) continue;
      insertLiveChildren(key.ptr, id);
    }

    lastFrameNewNodes_ = pendingNewNodes_;
    pendingNewNodes_ = 0;

    builder_.check(kCheckScopeTable, 0, 0, table_.tableHash());
    lastEmittedOps_ = builder_.opCount();

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
      notePendingHost(parent, node);
      return;
    }
    uint32_t parentId = idFor(parent);
    if (parentId == kNone) return;  // pai fora da projeção: nada a dizer
    const uint32_t existing = ids_.idOf(node, KeySpace::Node);
    if (existing != kNone) {
      cancelPendingDrop(existing);
    } else {
      ids_.assign(node, KeySpace::Node);
    }
    pendingInserts_.push_back(PendingInsert{parent, node});
  }

  void onRemoved(const void* parent, const void* node) {
    cancelPendingHost(node);
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    if (cancelPendingInsert(node)) {
      if (!table_.getRow(id)) ids_.release(node, KeySpace::Node);
      return;
    }
    uint32_t parentId = idFor(parent);
    builder_.remove(parentId, {id});
    table_.removeBatch(parentId, {id});
    // DROP no emitFrame, não aqui: o mesmo tick ainda pode reinserir (move).
    pendingDrop_.push_back(id);
  }

  void onAttrChanged(const void* node, const std::string& name) {
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    const Row* row = table_.getRow(id);
    if (!row || row->kind != static_cast<uint32_t>(NodeKind::Element)) {
      return;
    }
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
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    const Row* row = table_.getRow(id);
    if (!row) return;
    if (row->kind != static_cast<uint32_t>(NodeKind::Text) &&
        row->kind != static_cast<uint32_t>(NodeKind::Comment)) {
      return;
    }
    const std::string v = source_.valueOf(node);
    builder_.textSet(id, v);
    table_.setValue(id, v);
  }

  void onPropChanged(const void* node, uint8_t propId, const PropValue& value) {
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    if (value.isBool) {
      builder_.propSetBool(id, propId, value.boolValue);
    } else {
      builder_.propSetStr(id, propId, value.strValue);
    }
    table_.setProp(id, propId, value);
  }

  // Reserva: nó morreu sem passar por onRemoved (ou o teste chama os dois).
  // O caminho normal é ContentWillBeRemoved → onRemoved → DROP no emitFrame.
  // NodeWillBeDestroyed no Document NÃO dispara por filho; não dá para pendurar nisso.
  void onDestroyed(const void* node) {
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    const Row* row = table_.getRow(id);
    if (row && row->parent != kNone) return;  // ainda ligada: quem remove emite REMOVE antes
    cancelPendingDrop(id);
    if (!row) {
      ids_.release(node, KeySpace::Node);
      return;
    }
    builder_.nodeDrop({id});
    for (uint32_t dropped : table_.dropSubtree(id)) ids_.releaseId(dropped);
  }

  // ---- frame ordinário ----

  // Fecha o frame com CHECK(scope=Table) sobre o tableHash. preTableHash é o hash da
  // tabela no começo deste tick (depois do emit anterior), não o hash já mutado.
  void onSheetAdded(const void* sheet) {
    if (!sheet) return;
    ids_.assign(sheet, KeySpace::Sheet);
    pendingSheets_.push_back(sheet);
  }

  void onSheetRemoved(const void* sheet) {
    uint32_t id = ids_.idOf(sheet, KeySpace::Sheet);
    if (id == kNone) return;
    cancelPendingRulesOf(sheet);
    if (cancelPendingSheet(sheet)) {
      if (!table_.getRow(id)) ids_.release(sheet, KeySpace::Sheet);
      return;
    }
    builder_.sheetDrop({id});
    for (uint32_t dropped : table_.dropSubtree(id)) ids_.releaseId(dropped);
  }

  void onSheetOrderChanged() {
    std::vector<uint32_t> ids;
    for (const void* sheet : source_.cssomSheets()) {
      uint32_t id = ids_.idOf(sheet, KeySpace::Sheet);
      if (id != kNone && table_.getRow(id)) ids.push_back(id);
    }
    if (ids.size() < 2) return;
    builder_.sheetOrder(ids);
    const Row* first = table_.getRow(ids[0]);
    const uint32_t parent = first && first->parent != kNone ? first->parent : kDocumentId;
    table_.removeBatch(parent, ids);
    table_.insertBatch(parent, kInsertAtEnd, ids);
  }

  void onRuleAdded(const void* sheet, const void* rule) {
    if (!rule) return;
    if (sheet) ids_.assign(sheet, KeySpace::Sheet);
    ids_.assign(rule, KeySpace::Rule);
    pendingRules_.push_back(PendingRule{sheet, rule});
  }

  void onRuleRemoved(const void* sheet, const void* rule) {
    uint32_t id = ids_.idOf(rule, KeySpace::Rule);
    if (id == kNone) return;
    if (cancelPendingRule(rule)) {
      if (!table_.getRow(id)) ids_.release(rule, KeySpace::Rule);
      return;
    }
    uint32_t sheetId = ids_.idOf(sheet, KeySpace::Sheet);
    builder_.ruleDrop(sheetId, {id});
    for (uint32_t dropped : table_.dropSubtree(id)) ids_.releaseId(dropped);
  }

  void onRuleChanged(const void* rule) {
    uint32_t id = ids_.idOf(rule, KeySpace::Rule);
    if (id == kNone) return;
    if (!table_.getRow(id)) return;
    const std::string text = source_.cssomRuleTextOf(rule);
    builder_.ruleSet(id, text);
    table_.setValue(id, text);
  }

  std::vector<uint8_t> snapshotDump() const {
    std::vector<uint8_t> out;
    auto pushU32 = [&out](uint32_t v) {
      for (int i = 0; i < 4; ++i) out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
    };
    auto pushU64 = [&out](uint64_t v) {
      for (int i = 0; i < 8; ++i) out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
    };
    const auto rows = table_.allRowIds();
    pushU32(sequence_);
    pushU32(generation_);
    pushU32(contextId_);
    pushU64(table_.tableHash());
    pushU32(static_cast<uint32_t>(rows.size()));
    pushU32(lastFrameNewNodes_);
    for (uint32_t id : rows) {
      const Row* row = table_.getRow(id);
      pushU32(id);
      pushU32(row ? row->kind : 0);
      pushU32(row ? row->parent : 0);
      pushU64(row ? row->rowHash : 0);
    }
    return out;
  }

  // Devolve vazio quando não houve op: frame vazio não é emitido e não consome `sequence`.
  std::vector<uint8_t> emitFrame() {
    drainPendingInserts();
    flushPendingHosts();
    drainCssom();
    drainFormProps();
    flushPendingDrops();
    if (builder_.opCount() == 0) return {};
    lastFrameNewNodes_ = pendingNewNodes_;
    pendingNewNodes_ = 0;
    const uint64_t pre = preTableHash_;
    builder_.check(kCheckScopeTable, 0, 0, table_.tableHash());
    lastEmittedOps_ = builder_.opCount();

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
    return ids_.idOf(node, KeySpace::Node);
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
      uint32_t id = ids_.idOf(k, KeySpace::Node);
      if (id != kNone && table_.getRow(id)) return id;
    }
    return kInsertAtEnd;
  }

  // "Já indexado" (§5.5) = linha na tabela com NODE_NEW, não só id em onInserted.
  // onInserted reserva o id cedo; sem esta distinção o walk do pai emite INSERT
  // do filho antes do NODE_NEW (Beleza/criteo: pai+filho no mesmo tick).
  void ensureDescribed(const void* node) {
    if (ids_.known(node, KeySpace::Node)) {
      const uint32_t id = ids_.idOf(node, KeySpace::Node);
      const Row* row = table_.getRow(id);
      const auto kind = static_cast<uint32_t>(source_.kindOf(node));
      if (row && row->kind == kind) return;
      if (row) {
        // Mesmo endereço, outro nó: o alocador reusou o ponteiro. Id velho não cola.
        retireDetached(id);
      } else {
        // Id reservado em onInserted; ainda sem NODE_NEW — emite com o id já mintado.
        emitNodeNew(node, id);
        attachShadow(node);
        describeAndInsertChildren(node, id);
        return;
      }
    }
    describe(node);
    describeAndInsertChildren(node, ids_.idOf(node, KeySpace::Node));
  }

  void cancelPendingDrop(uint32_t id) {
    size_t w = 0;
    for (size_t i = 0; i < pendingDrop_.size(); ++i) {
      if (pendingDrop_[i] != id) pendingDrop_[w++] = pendingDrop_[i];
    }
    pendingDrop_.resize(w);
  }

  bool cancelPendingInsert(const void* node) {
    size_t w = 0;
    bool found = false;
    for (size_t i = 0; i < pendingInserts_.size(); ++i) {
      if (pendingInserts_[i].node == node) {
        found = true;
        continue;
      }
      pendingInserts_[w++] = pendingInserts_[i];
    }
    pendingInserts_.resize(w);
    return found;
  }

  bool cancelPendingHost(const void* node) {
    size_t w = 0;
    bool found = false;
    for (size_t i = 0; i < pendingHosts_.size(); ++i) {
      if (pendingHosts_[i].node == node) {
        found = true;
        continue;
      }
      pendingHosts_[w++] = pendingHosts_[i];
    }
    pendingHosts_.resize(w);
    return found;
  }

  void drainPendingInserts() {
    const std::vector<PendingInsert> pending = pendingInserts_;
    pendingInserts_.clear();
    for (const auto& item : pending) {
      uint32_t id = ids_.idOf(item.node, KeySpace::Node);
      if (id == kNone) continue;
      if (!source_.isConnected(item.node) || source_.isUaOwned(item.node)) {
        if (!table_.getRow(id)) ids_.release(item.node, KeySpace::Node);
        continue;
      }
      uint32_t parentId = idFor(item.parent);
      if (parentId == kNone) {
        if (!table_.getRow(id)) ids_.release(item.node, KeySpace::Node);
        continue;
      }
      if (!table_.getRow(id)) {
        ensureDescribed(item.node);
        id = ids_.idOf(item.node, KeySpace::Node);
        if (id == kNone) continue;
      }
      uint32_t before = beforeIdOf(item.parent, item.node);
      builder_.insert(parentId, before, {id});
      table_.insertBatch(parentId, before, {id});
    }
  }

  bool cancelPendingSheet(const void* sheet) {
    size_t w = 0;
    bool found = false;
    for (size_t i = 0; i < pendingSheets_.size(); ++i) {
      if (pendingSheets_[i] == sheet) {
        found = true;
        continue;
      }
      pendingSheets_[w++] = pendingSheets_[i];
    }
    pendingSheets_.resize(w);
    return found;
  }

  bool cancelPendingRule(const void* rule) {
    size_t w = 0;
    bool found = false;
    for (size_t i = 0; i < pendingRules_.size(); ++i) {
      if (pendingRules_[i].rule == rule) {
        found = true;
        continue;
      }
      pendingRules_[w++] = pendingRules_[i];
    }
    pendingRules_.resize(w);
    return found;
  }

  void cancelPendingRulesOf(const void* sheet) {
    size_t w = 0;
    for (size_t i = 0; i < pendingRules_.size(); ++i) {
      if (pendingRules_[i].sheet == sheet) {
        uint32_t id = ids_.idOf(pendingRules_[i].rule, KeySpace::Rule);
        if (id != kNone && !table_.getRow(id)) ids_.release(pendingRules_[i].rule, KeySpace::Rule);
        continue;
      }
      pendingRules_[w++] = pendingRules_[i];
    }
    pendingRules_.resize(w);
  }

  void drainCssom() {
    const std::vector<const void*> queuedSheets = pendingSheets_;
    pendingSheets_.clear();
    const std::vector<PendingRule> queuedRules = pendingRules_;
    pendingRules_.clear();

    for (const void* sheet : source_.cssomSheets()) {
      uint32_t id = ids_.idOf(sheet, KeySpace::Sheet);
      if (id == kNone) continue;
      if (!table_.getRow(id)) emitSheetNew(sheet, id);
    }
    for (const void* sheet : source_.cssomSheets()) {
      for (const void* rule : source_.cssomRulesOf(sheet)) {
        uint32_t id = ids_.idOf(rule, KeySpace::Rule);
        if (id == kNone) continue;
        if (!table_.getRow(id)) emitRuleNew(sheet, rule, id);
      }
    }
    for (const void* sheet : queuedSheets) {
      uint32_t id = ids_.idOf(sheet, KeySpace::Sheet);
      if (id != kNone && !table_.getRow(id)) ids_.release(sheet, KeySpace::Sheet);
    }
    for (const auto& item : queuedRules) {
      uint32_t id = ids_.idOf(item.rule, KeySpace::Rule);
      if (id != kNone && !table_.getRow(id)) ids_.release(item.rule, KeySpace::Rule);
    }
  }

  void drainFormProps() {
    const std::vector<uint32_t> ids = ids_.allIds();
    for (uint32_t id : ids) {
      const IdentityKey key = ids_.keyOf(id);
      if (!key.ptr || key.space != KeySpace::Node) continue;
      if (source_.kindOf(key.ptr) != NodeKind::Element) continue;
      for (const FormProp& fp : source_.formPropsOf(key.ptr)) {
        const PropValue* cur = table_.getProp(id, fp.id);
        const bool same = cur && cur->isBool == fp.value.isBool &&
                          (fp.value.isBool ? cur->boolValue == fp.value.boolValue
                                           : cur->strValue == fp.value.strValue);
        if (same) continue;
        onPropChanged(key.ptr, fp.id, fp.value);
      }
    }
  }

  void emitSheetNew(const void* sheet, uint32_t id) {
    const uint32_t host = 0;
    const uint8_t scope = 0;
    const uint32_t before = kInsertAtEnd;
    builder_.sheetNew(id, scope, host, before);
    if (!table_.has(id)) table_.createLeafRow(id, NodeKind::Sheet, "");
    table_.insertBatch(kDocumentId, before, {id});
    ++pendingNewNodes_;
    (void)sheet;
  }

  void emitRuleNew(const void* sheet, const void* rule, uint32_t id) {
    uint32_t sheetId = ids_.idOf(sheet, KeySpace::Sheet);
    if (sheetId == kNone && sheet) sheetId = ids_.assign(sheet, KeySpace::Sheet);
    if (sheet && sheetId != kNone && !table_.getRow(sheetId)) {
      emitSheetNew(sheet, sheetId);
    }
    const std::string text = source_.cssomRuleTextOf(rule);
    builder_.ruleNew(sheetId, id, kInsertAtEnd, text);
    if (!table_.has(id)) table_.createLeafRow(id, NodeKind::Rule, text);
    else table_.setValue(id, text);
    table_.insertBatch(sheetId, kInsertAtEnd, {id});
    ++pendingNewNodes_;
  }

  void allocateCssom() {
    for (const void* sheet : source_.cssomSheets()) {
      ids_.assign(sheet, KeySpace::Sheet);
      for (const void* rule : source_.cssomRulesOf(sheet)) ids_.assign(rule, KeySpace::Rule);
    }
  }

  void attachShadow(const void* host) {
    const void* sr = source_.shadowRootOf(host);
    if (!sr || source_.isUaOwned(sr)) return;
    const uint32_t id = ids_.idOf(sr, KeySpace::Node);
    if (id != kNone && table_.getRow(id)) return;
    ensureDescribed(sr);
  }

  void retireDetached(uint32_t id) {
    cancelPendingDrop(id);
    const Row* row = table_.getRow(id);
    if (!row) {
      ids_.releaseId(id);
      return;
    }
    if (row->parent != kNone) {
      builder_.remove(row->parent, {id});
      table_.removeBatch(row->parent, {id});
    }
    builder_.nodeDrop({id});
    for (uint32_t dropped : table_.dropSubtree(id)) ids_.releaseId(dropped);
  }

  void flushPendingDrops() {
    const std::vector<uint32_t> snapshot = pendingDrop_;
    pendingDrop_.clear();
    for (uint32_t id : snapshot) {
      const Row* row = table_.getRow(id);
      if (!row) {
        ids_.releaseId(id);
        continue;
      }
      if (row->parent != kNone) continue;  // reinseriu neste tick: move, não GC
      builder_.nodeDrop({id});
      for (uint32_t dropped : table_.dropSubtree(id)) ids_.releaseId(dropped);
    }
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
      if (!source_.isConnected(pending.node) || source_.isUaOwned(pending.node)) {
        continue;
      }
      if (awaitingChildScope(pending.node)) {
        still.push_back(pending);
        continue;
      }
      ids_.assign(pending.node, KeySpace::Node);
    }
    pendingHosts_.swap(still);
  }

  void flushPendingHosts() {
    std::vector<PendingHost> still;
    still.reserve(pendingHosts_.size());
    for (const auto& pending : pendingHosts_) {
      if (!source_.isConnected(pending.node) || source_.isUaOwned(pending.node)) {
        continue;
      }
      if (awaitingChildScope(pending.node)) {
        still.push_back(pending);
        continue;
      }
      uint32_t parentId = idFor(pending.parent);
      if (parentId == kNone) continue;
      uint32_t before = beforeIdOf(pending.parent, pending.node);
      ensureDescribed(pending.node);
      builder_.insert(parentId, before, {ids_.idOf(pending.node, KeySpace::Node)});
      table_.insertBatch(parentId, before, {ids_.idOf(pending.node, KeySpace::Node)});
    }
    pendingHosts_.swap(still);
  }

  void allocateConnected(const void* node) {
    if (node != documentNode_) {
      if (source_.isUaOwned(node) || awaitingChildScope(node)) return;
      ids_.assign(node, KeySpace::Node);
    }
    for (const void* child : source_.childrenOf(node)) {
      if (source_.isUaOwned(child)) continue;
      if (awaitingChildScope(child)) {
        notePendingHost(node, child);
        continue;
      }
      allocateConnected(child);
    }
    const void* sr = source_.shadowRootOf(node);
    if (sr && !source_.isUaOwned(sr)) allocateConnected(sr);
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
        ++pendingNewNodes_;
        break;
      }
      case NodeKind::Text: {
        const auto v = source_.valueOf(node);
        builder_.nodeNewText(id, v);
        table_.createLeafRow(id, NodeKind::Text, v);
        ++pendingNewNodes_;
        break;
      }
      case NodeKind::Comment: {
        const auto v = source_.valueOf(node);
        builder_.nodeNewComment(id, v);
        table_.createLeafRow(id, NodeKind::Comment, v);
        ++pendingNewNodes_;
        break;
      }
      case NodeKind::Doctype: {
        const auto n = source_.nameOf(node);
        builder_.nodeNewDoctype(id, n);
        table_.createLeafRow(id, NodeKind::Doctype, n);
        ++pendingNewNodes_;
        break;
      }
      case NodeKind::ShadowRoot: {
        const void* host = source_.shadowHostOf(node);
        uint32_t hostId = idFor(host);
        uint8_t mode = source_.shadowModeOf(node);
        builder_.nodeNewShadowRoot(id, hostId, mode, 0);
        table_.createShadowRootRow(id, hostId, mode, 0);
        ++pendingNewNodes_;
        break;
      }
      default:
        break;
    }
  }

  void describe(const void* node) {
    emitNodeNew(node, ids_.assign(node, KeySpace::Node));
    attachShadow(node);
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
      uint32_t id = ids_.idOf(child, KeySpace::Node);
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
      // §5.5: identity hit só conta se a linha já existe (NODE_NEW feito).
      // Id só de onInserted ainda precisa de describe antes do INSERT.
      uint32_t id = ids_.idOf(child, KeySpace::Node);
      const Row* row = id != kNone ? table_.getRow(id) : nullptr;
      if (!row || row->kind != static_cast<uint32_t>(source_.kindOf(child))) {
        ensureDescribed(child);
        id = ids_.idOf(child, KeySpace::Node);
        if (id == kNone || !table_.getRow(id)) continue;
      }
      batch.push_back(id);
    }
    if (batch.empty()) return;
    builder_.insert(parentId, kInsertAtEnd, batch);
    table_.insertBatch(parentId, kInsertAtEnd, batch);
  }

  struct PendingHost {
    const void* parent;
    const void* node;
  };

  struct PendingInsert {
    const void* parent;
    const void* node;
  };

  struct PendingRule {
    const void* sheet;
    const void* rule;
  };

  NodeSource& source_;
  IdentityMap ids_;
  ReplicatedTable table_;
  FramePartBuilder builder_;
  std::vector<PendingHost> pendingHosts_;
  std::vector<PendingInsert> pendingInserts_;
  std::vector<const void*> pendingSheets_;
  std::vector<PendingRule> pendingRules_;
  std::vector<uint32_t> pendingDrop_;
  const void* documentNode_ = nullptr;
  uint32_t contextId_;
  uint32_t generation_;
  uint32_t sequence_ = 0;
  uint64_t preTableHash_ = 0;
  bool halted_ = false;
  uint32_t lastFrameNewNodes_ = 0;
  uint32_t lastEmittedOps_ = 0;
  uint32_t pendingNewNodes_ = 0;
};

}  // namespace speculum
