// Speculum — o produtor: registro do motor -> op -> aplica na NOSSA tabela -> atualiza hash
// -> emite. Essa é a ordem, e ela não se simplifica: o hash por frame existe porque a tabela
// do produtor e a do cliente têm que concordar dentro da mesma execução.
//
// Esta camada é pura. Ela lê a árvore viva por uma interface (`NodeSource`) que o lado do
// motor implementa — no Gecko, sobre `nsINode`. Assim o algoritmo do produtor é testável
// fora da árvore do Gecko, e o que sobra lá dentro é cola.
#pragma once
#include "speculum/Identity.h"
#include "speculum/Limits.h"
#include "speculum/Table.h"
#include "speculum/Wire.h"

#include <algorithm>
#include <cstddef>
#include <string>
#include <unordered_map>
#include <unordered_set>
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
  virtual uint8_t shadowInitFlagsOf(const void* /*shadowRoot*/) const { return 0; }
  virtual std::vector<FormProp> formPropsOf(const void* /*node*/) const { return {}; }
  virtual std::vector<const void*> cssomSheets() const { return {}; }
  virtual std::vector<const void*> cssomRulesOf(const void* /*sheet*/) const { return {}; }
  virtual std::vector<const void*> cssomChildSheets(const void* /*sheet*/) const { return {}; }
  virtual std::string cssomRuleTextOf(const void* /*rule*/) const { return {}; }
  virtual const void* cssomSheetOf(const void* /*rule*/) const { return nullptr; }
  // Host element of an adopted/constructed sheet (0/null = document). Pierce.
  virtual const void* cssomHostOf(const void* /*sheet*/) const { return nullptr; }
  // Live CSSOM set — not "this pointer was a sheet once". emitResyncFrame drops
  // Sheet/Rule ids that fail these, without casting the pointer to nsINode.
  virtual bool isSheet(const void* /*ptr*/) const { return false; }
  virtual bool isRule(const void* /*ptr*/) const { return false; }
  // Motor holds the live object while identity names it. Gecko: AddRef. Tests: no-op.
  virtual void retainPtr(const void* /*ptr*/, KeySpace /*space*/) {}
  virtual void releasePtr(const void* /*ptr*/, KeySpace /*space*/) {}
};

class Producer {
 public:
  Producer(NodeSource& source, uint32_t contextId = kContextIdRoot, uint32_t generation = 0)
      : source_(source), contextId_(contextId), generation_(generation) {
    builder_.begin();
  }

  ~Producer() { forgetAll(); }
  Producer(const Producer&) = delete;
  Producer& operator=(const Producer&) = delete;

  const ReplicatedTable& table() const { return table_; }
  const IdentityMap& identity() const { return ids_; }
  uint32_t sequence() const { return sequence_; }
  uint32_t pendingOps() const { return builder_.opCount(); }
  uint32_t generation() const { return generation_; }
  uint32_t lastFrameNewNodes() const { return lastFrameNewNodes_; }
  uint32_t lastEmittedOps() const { return lastEmittedOps_; }
  uint32_t lastInsertIdCount() const { return lastInsertIdCount_; }
  uint32_t lastInsertOpCount() const { return lastInsertOpCount_; }
  bool mintHeld() const { return hasMintHold(); }
  const std::vector<std::vector<uint8_t>>& lastFrameParts() const { return lastFrameParts_; }
  const std::vector<uint32_t>& lastPublishedNestedIds() const {
    return lastPublishedNestedIds_;
  }
  bool halted() const { return halted_; }

  // Halt para o relógio. A fila continua; Flush chama emitFrame. Não é discard.
  void setHalted(bool halted) { halted_ = halted; }
  void setGeneration(uint32_t generation) { generation_ = generation; }
  void addFrameCredit(uint32_t frames, uint32_t bytes) {
    creditFrames_ += frames;
    creditBytes_ += bytes;
  }
  bool hasFrameCredit(uint32_t bytes) const {
    return creditFrames_ > 0 && creditBytes_ >= bytes;
  }
  void consumeFrameCredit(uint32_t bytes) {
    if (creditFrames_ > 0) --creditFrames_;
    if (creditBytes_ >= bytes) creditBytes_ -= bytes;
    else creditBytes_ = 0;
  }

  // Halt do tick: ops não emitidas caem. O resync descreve o DOM vivo.
  void discardPending() {
    builder_.begin();
    pendingInserts_.clear();
    pendingRemoves_.clear();
    pendingSheets_.clear();
    pendingRules_.clear();
    dirtyAttrs_.clear();
    dirtyText_.clear();
  }

  // §5.8 resyncVirtual: zera o mapa (geração intacta), aloca o que está ligado, emite
  // o frame de resync. Attach do documento é isto — não um caminho paralelo.
  std::vector<uint8_t> resyncVirtual(const void* documentNode) {
    forgetAll();
    pendingHosts_.clear();
    pendingDrop_.clear();
    pendingInserts_.clear();
    pendingRemoves_.clear();
    formIndex_.clear();
    documentNode_ = documentNode;
    discardPending();
    allocateConnected(documentNode);
    allocateCssom();
    return emitResyncFrame();
  }

  // §5.8 emitResyncFrame: duas passagens no mapa, tabela reconstruída, flag de resync.
  // preTableHash viaja 0 — o cliente não tem estado prévio a conferir (wholesale replace).
  std::vector<uint8_t> emitResyncFrame() {
    lastPublishedNestedIds_.clear();
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
    for (uint32_t id : drop) forgetId(id);
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
    drainFormProps();

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
    auto parts = builder_.finishSplit(h, kMaxOpsPerFrame, kMaxFrameBytes);
    sequence_ = seq;
    preTableHash_ = table_.tableHash();
    builder_.begin();
    table_.setSequence(sequence_ + 1);
    lastFrameParts_ = parts;
    return parts.empty() ? std::vector<uint8_t>{} : parts.front();
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
      const Row* row = table_.getRow(existing);
      if (row && row->kind != static_cast<uint32_t>(source_.kindOf(node))) {
        retireDetached(existing);
        mint(node, KeySpace::Node);
      }
    } else {
      mint(node, KeySpace::Node);
    }
    pendingInserts_.push_back(PendingInsert{parent, node});
  }

  void onShadowAttached(const void* host) { attachShadow(host); }

  void onRemoved(const void* parent, const void* node) {
    cancelPendingHost(node);
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    if (cancelPendingInsert(node)) {
      if (!table_.getRow(id)) forget(node, KeySpace::Node);
      return;
    }
    // §5.6: não emite REMOVE na hora. Move no mesmo tick decide no drain
    // contra o DOM vivo (isConnected). DROP continua no fim do tick.
    pendingRemoves_.push_back(PendingRemove{parent, node});
    pendingDrop_.push_back(id);
  }

  void onAttrChanged(const void* node, const std::string& name) {
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    auto& names = dirtyAttrs_[node];
    for (const auto& n : names) {
      if (n == name) return;
    }
    names.push_back(name);
  }

  void onTextChanged(const void* node) {
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    dirtyText_.insert(node);
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

  // Reserva: o motor avisou que o objeto morreu. Solta o ponteiro agora —
  // isConnected no drain senão lê lixo. ContentWillBeRemoved pode não ter
  // rodado (teardown do document).
  void onDestroyed(const void* node) {
    uint32_t id = ids_.idOf(node, KeySpace::Node);
    if (id == kNone) return;
    cancelPendingDrop(id);
    cancelPendingInsert(node);
    cancelPendingHost(node);
    cancelPendingRemove(node);
    unindexForm(node);
    dirtyAttrs_.erase(node);
    dirtyText_.erase(node);
    const Row* row = table_.getRow(id);
    if (row && row->parent != kNone) {
      builder_.remove(row->parent, {id});
      table_.removeBatch(row->parent, {id});
    }
    if (row) {
      builder_.nodeDrop({id});
      for (uint32_t dropped : table_.dropSubtree(id)) forgetId(dropped);
      return;
    }
    forget(node, KeySpace::Node);
  }

  // ---- frame ordinário ----

  // Fecha o frame com CHECK(scope=Table) sobre o tableHash. preTableHash é o hash da
  // tabela no começo deste tick (depois do emit anterior), não o hash já mutado.
  void onSheetAdded(const void* sheet) {
    if (!sheet) return;
    mint(sheet, KeySpace::Sheet);
    pendingSheets_.push_back(sheet);
  }

  void onSheetRemoved(const void* sheet) {
    uint32_t id = ids_.idOf(sheet, KeySpace::Sheet);
    if (id == kNone) return;
    cancelPendingRulesOf(sheet);
    if (cancelPendingSheet(sheet)) {
      if (!table_.getRow(id)) forget(sheet, KeySpace::Sheet);
      return;
    }
    builder_.sheetDrop({id});
    for (uint32_t dropped : table_.dropSubtree(id)) forgetId(dropped);
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
    if (sheet) mint(sheet, KeySpace::Sheet);
    mint(rule, KeySpace::Rule);
    pendingRules_.push_back(PendingRule{sheet, rule});
  }

  void onRuleRemoved(const void* sheet, const void* rule) {
    uint32_t id = ids_.idOf(rule, KeySpace::Rule);
    if (id == kNone) return;
    if (cancelPendingRule(rule)) {
      if (!table_.getRow(id)) forget(rule, KeySpace::Rule);
      return;
    }
    uint32_t sheetId = ids_.idOf(sheet, KeySpace::Sheet);
    builder_.ruleDrop(sheetId, {id});
    for (uint32_t dropped : table_.dropSubtree(id)) forgetId(dropped);
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

  // Devolve vazio quando não houve op, mint hold, ou frame vazio: não consome `sequence`.
  std::vector<uint8_t> emitFrame() {
    lastInsertIdCount_ = 0;
    lastInsertOpCount_ = 0;
    lastFrameParts_.clear();
    lastPublishedNestedIds_.clear();
    createdThisTick_.clear();
    visitedThisTick_.clear();
    ++gcClock_;
    table_.setSequence(gcClock_);
    if (hasMintHold()) return {};
    drainPendingInserts();
    flushPendingHosts();
    drainPendingRemoves();
    drainAttrPatches();
    drainTextPatches();
    drainCssom();
    drainFormProps();
    emitAgedDrops();
    if (builder_.opCount() == 0) return {};
    lastFrameNewNodes_ = pendingNewNodes_;
    pendingNewNodes_ = 0;
    const uint64_t pre = preTableHash_;
    builder_.check(kCheckScopeTable, 0, 0, table_.tableHash());
    lastEmittedOps_ = builder_.opCount();

    PartHeader h;
    h.contextId = contextId_;
    h.generation = generation_;
    h.sequence = sequence_ + 1;
    h.flags = 0;
    h.preTableHash = pre;
    lastFrameParts_ = builder_.finishSplit(h, kMaxOpsPerFrame, kMaxFrameBytes);
    if (lastFrameParts_.empty()) {
      builder_.begin();
      return {};
    }
    sequence_ = h.sequence;
    preTableHash_ = table_.tableHash();
    builder_.begin();
    return lastFrameParts_.front();
  }

 private:
  uint32_t mint(const void* ptr, KeySpace space) {
    if (!ptr) return kNone;
    if (ids_.known(ptr, space)) return ids_.idOf(ptr, space);
    source_.retainPtr(ptr, space);
    return ids_.assign(ptr, space);
  }

  void forget(const void* ptr, KeySpace space) {
    if (ids_.release(ptr, space) == kNone) return;
    source_.releasePtr(ptr, space);
  }

  void forgetId(uint32_t id) {
    const IdentityKey key = ids_.keyOf(id);
    ids_.releaseId(id);
    if (key.ptr) source_.releasePtr(key.ptr, key.space);
  }

  void forgetAll() {
    for (uint32_t id : ids_.allIds()) {
      const IdentityKey key = ids_.keyOf(id);
      if (key.ptr) source_.releasePtr(key.ptr, key.space);
    }
    ids_.clear();
  }

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

  void cancelPendingRemove(const void* node) {
    size_t w = 0;
    for (size_t i = 0; i < pendingRemoves_.size(); ++i) {
      if (pendingRemoves_[i].node != node) pendingRemoves_[w++] = pendingRemoves_[i];
    }
    pendingRemoves_.resize(w);
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

  void notePublishedNested(uint32_t childScope) {
    if (childScope < 2) return;
    for (uint32_t c : lastPublishedNestedIds_) {
      if (c == childScope) return;
    }
    lastPublishedNestedIds_.push_back(childScope);
  }

  bool hasMintHold() const {
    for (const auto& pending : pendingHosts_) {
      if (source_.isConnected(pending.node) && awaitingChildScope(pending.node)) return true;
    }
    return false;
  }

  void emitInsert(uint32_t parentId, uint32_t before, const std::vector<uint32_t>& ids) {
    if (ids.empty()) return;
    lastInsertIdCount_ += static_cast<uint32_t>(ids.size());
    size_t i = 0;
    while (i < ids.size()) {
      const size_t n = std::min(ids.size() - i, static_cast<size_t>(kMaxChildrenPerOp));
      std::vector<uint32_t> chunk(ids.begin() + static_cast<std::ptrdiff_t>(i),
                                  ids.begin() + static_cast<std::ptrdiff_t>(i + n));
      builder_.insert(parentId, before, chunk);
      table_.insertBatch(parentId, before, chunk);
      ++lastInsertOpCount_;
      i += n;
    }
  }

  void drainAttrPatches() {
    auto dirty = dirtyAttrs_;
    dirtyAttrs_.clear();
    for (const auto& kv : dirty) {
      const void* node = kv.first;
      if (createdThisTick_.count(node)) continue;
      if (!source_.isConnected(node)) continue;
      uint32_t id = ids_.idOf(node, KeySpace::Node);
      if (id == kNone) continue;
      const Row* row = table_.getRow(id);
      if (!row || row->kind != static_cast<uint32_t>(NodeKind::Element)) continue;
      const auto live = source_.attrsOf(node);
      std::vector<AttrPair> setAttrs;
      std::vector<std::string> delNames;
      for (const auto& name : kv.second) {
        bool found = false;
        for (const auto& a : live) {
          if (a.name != name) continue;
          setAttrs.push_back(a);
          found = true;
          break;
        }
        if (!found) delNames.push_back(name);
      }
      if (!setAttrs.empty()) {
        builder_.attrSet(id, setAttrs);
        table_.setAttrs(id, setAttrs);
      }
      if (!delNames.empty()) {
        builder_.attrDel(id, delNames);
        table_.delAttrs(id, delNames);
      }
    }
  }

  void drainTextPatches() {
    auto dirty = dirtyText_;
    dirtyText_.clear();
    for (const void* node : dirty) {
      if (createdThisTick_.count(node)) continue;
      if (!source_.isConnected(node)) continue;
      uint32_t id = ids_.idOf(node, KeySpace::Node);
      if (id == kNone) continue;
      const Row* row = table_.getRow(id);
      if (!row) continue;
      if (row->kind != static_cast<uint32_t>(NodeKind::Text) &&
          row->kind != static_cast<uint32_t>(NodeKind::Comment)) {
        continue;
      }
      const std::string v = source_.valueOf(node);
      builder_.textSet(id, v);
      table_.setValue(id, v);
    }
  }

  void drainPendingRemoves() {
    const std::vector<PendingRemove> pending = pendingRemoves_;
    pendingRemoves_.clear();
    for (const auto& item : pending) {
      if (source_.isConnected(item.node)) continue;  // move: o INSERT já desligou
      uint32_t id = ids_.idOf(item.node, KeySpace::Node);
      if (id == kNone) continue;
      const Row* row = table_.getRow(id);
      if (!row || row->parent == kNone) continue;  // já saiu (INSERT moveu, ou nunca ligou)
      uint32_t parentId = idFor(item.parent);
      if (parentId == kNone) parentId = row->parent;
      builder_.remove(parentId, {id});
      table_.removeBatch(parentId, {id});
    }
  }

  void drainPendingInserts() {
    const std::vector<PendingInsert> pending = pendingInserts_;
    pendingInserts_.clear();
    std::vector<const void*> parentOrder;
    std::unordered_map<const void*, std::vector<const void*>> byParent;
    std::unordered_set<const void*> pendingSet;
    for (const auto& item : pending) {
      uint32_t id = ids_.idOf(item.node, KeySpace::Node);
      if (id == kNone) continue;
      if (!source_.isConnected(item.node) || source_.isUaOwned(item.node)) {
        if (!table_.getRow(id)) forget(item.node, KeySpace::Node);
        continue;
      }
      if (visitedThisTick_.count(item.node)) continue;
      if (pendingSet.insert(item.node).second) {
        auto& list = byParent[item.parent];
        if (list.empty()) parentOrder.push_back(item.parent);
        list.push_back(item.node);
      }
    }
    for (const void* parent : parentOrder) {
      uint32_t parentId = idFor(parent);
      if (parentId == kNone) {
        for (const void* node : byParent[parent]) {
          uint32_t id = ids_.idOf(node, KeySpace::Node);
          if (id != kNone && !table_.getRow(id)) forget(node, KeySpace::Node);
        }
        continue;
      }
      const auto live = source_.childrenOf(parent);
      std::unordered_set<const void*> want;
      for (const void* n : byParent[parent]) want.insert(n);
      std::vector<uint32_t> run;
      const void* runLast = nullptr;
      auto flushRun = [&]() {
        if (run.empty() || !runLast) return;
        emitInsert(parentId, beforeIdOf(parent, runLast), run);
        run.clear();
        runLast = nullptr;
      };
      for (const void* child : live) {
        if (!want.count(child) || visitedThisTick_.count(child)) {
          flushRun();
          continue;
        }
        if (!table_.getRow(ids_.idOf(child, KeySpace::Node))) {
          ensureDescribed(child);
        }
        uint32_t id = ids_.idOf(child, KeySpace::Node);
        if (id == kNone || !table_.getRow(id)) {
          flushRun();
          continue;
        }
        if (visitedThisTick_.count(child)) {
          flushRun();
          continue;
        }
        visitedThisTick_.insert(child);
        run.push_back(id);
        runLast = child;
      }
      flushRun();
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
        if (id != kNone && !table_.getRow(id)) forget(pendingRules_[i].rule, KeySpace::Rule);
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
    for (const void* sheet : queuedSheets) {
      uint32_t id = ids_.idOf(sheet, KeySpace::Sheet);
      if (id == kNone) continue;
      if (!table_.getRow(id)) emitSheetNew(sheet, id);
    }
    for (const auto& item : queuedRules) {
      uint32_t id = ids_.idOf(item.rule, KeySpace::Rule);
      if (id == kNone) continue;
      if (!table_.getRow(id)) emitRuleNew(item.sheet, item.rule, id);
    }
  }

  void drainFormProps() {
    for (const void* node : formIndex_) {
      uint32_t id = ids_.idOf(node, KeySpace::Node);
      if (id == kNone) continue;
      if (!source_.isConnected(node)) continue;
      for (const FormProp& fp : source_.formPropsOf(node)) {
        const PropValue* cur = table_.getProp(id, fp.id);
        const bool same = cur && cur->isBool == fp.value.isBool &&
                          (fp.value.isBool ? cur->boolValue == fp.value.boolValue
                                           : cur->strValue == fp.value.strValue);
        if (same) continue;
        onPropChanged(node, fp.id, fp.value);
      }
    }
  }

  void indexForm(const void* node) {
    if (!node) return;
    for (const void* n : formIndex_) {
      if (n == node) return;
    }
    formIndex_.push_back(node);
  }

  void unindexForm(const void* node) {
    size_t w = 0;
    for (size_t i = 0; i < formIndex_.size(); ++i) {
      if (formIndex_[i] != node) formIndex_[w++] = formIndex_[i];
    }
    formIndex_.resize(w);
  }

  void ensureRowBudget() {
    if (table_.size() < kMaxRows) return;
    emitAgedDrops();
    if (table_.size() >= kMaxRows) {
      SPECULUM_FATAL("ReplicatedTable: MAX_ROWS exceeded (frame-protocol.md §8)");
    }
  }

  void emitSheetNew(const void* sheet, uint32_t id) {
    ensureRowBudget();
    const void* hostPtr = source_.cssomHostOf(sheet);
    uint32_t host = 0;
    uint8_t scope = kCssomScopeMain;
    uint32_t parent = kDocumentId;
    if (hostPtr) {
      host = idFor(hostPtr);
      if (host != kNone) {
        scope = kCssomScopePierceHost;
        parent = host;
      }
    }
    const uint32_t before = kInsertAtEnd;
    builder_.sheetNew(id, scope, host, before);
    if (!table_.has(id)) table_.createLeafRow(id, NodeKind::Sheet, "");
    table_.insertBatch(parent, before, {id});
    ++pendingNewNodes_;
  }

  void emitRuleNew(const void* sheet, const void* rule, uint32_t id) {
    ensureRowBudget();
    const std::string text = source_.cssomRuleTextOf(rule);
    bool blank = true;
    for (char c : text) {
      if (c != ' ' && c != '\n' && c != '\r' && c != '\t') {
        blank = false;
        break;
      }
    }
    if (blank) {
      forget(rule, KeySpace::Rule);
      return;
    }
    uint32_t sheetId = ids_.idOf(sheet, KeySpace::Sheet);
    if (sheetId == kNone && sheet) sheetId = mint(sheet, KeySpace::Sheet);
    if (sheet && sheetId != kNone && !table_.getRow(sheetId)) {
      emitSheetNew(sheet, sheetId);
    }
    builder_.ruleNew(sheetId, id, kInsertAtEnd, text);
    if (!table_.has(id)) table_.createLeafRow(id, NodeKind::Rule, text);
    else table_.setValue(id, text);
    table_.insertBatch(sheetId, kInsertAtEnd, {id});
    ++pendingNewNodes_;
  }

  void allocateCssom() {
    std::vector<const void*> stack = source_.cssomSheets();
    std::unordered_set<const void*> seen;
    while (!stack.empty()) {
      const void* sheet = stack.back();
      stack.pop_back();
      if (!sheet || !seen.insert(sheet).second) continue;
      mint(sheet, KeySpace::Sheet);
      for (const void* rule : source_.cssomRulesOf(sheet)) mint(rule, KeySpace::Rule);
      for (const void* child : source_.cssomChildSheets(sheet)) stack.push_back(child);
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
      forgetId(id);
      return;
    }
    if (row->parent != kNone) {
      builder_.remove(row->parent, {id});
      table_.removeBatch(row->parent, {id});
    }
    builder_.nodeDrop({id});
    for (uint32_t dropped : table_.dropSubtree(id)) forgetId(dropped);
  }

  void flushPendingDrops() {
    // OPEN-2: destaque neste tick não DROP. Sweep por idade em emitAgedDrops.
  }

  void emitAgedDrops() {
    if (table_.size() >= kMaxRows) {
      // Pressão: GC de linha morta primeiro (ruling 2026-09-16).
    }
    const uint32_t seq = gcClock_ ? gcClock_ : sequence_ + 1;
    auto droppable =
        table_.collectDroppableIds(seq, kNodeDropAgeSequences, kMaxNodeDropsPerSweep);
    if (table_.size() >= kMaxRows && droppable.empty()) {
      droppable = table_.collectDroppableIds(seq, 1, kMaxNodeDropsPerSweep);
    }
    for (uint32_t id : droppable) {
      const Row* row = table_.getRow(id);
      if (!row || row->parent != kNone) continue;
      const IdentityKey key = ids_.keyOf(id);
      if (key.ptr) unindexForm(key.ptr);
      builder_.nodeDrop({id});
      for (uint32_t dropped : table_.dropSubtree(id)) forgetId(dropped);
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
      mint(pending.node, KeySpace::Node);
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
      emitInsert(parentId, before, {ids_.idOf(pending.node, KeySpace::Node)});
    }
    pendingHosts_.swap(still);
  }

  void allocateConnected(const void* node) {
    if (node != documentNode_) {
      if (source_.isUaOwned(node) || awaitingChildScope(node)) return;
      mint(node, KeySpace::Node);
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
    ensureRowBudget();
    const NodeKind kind = source_.kindOf(node);
    switch (kind) {
      case NodeKind::Element: {
        const auto ns = source_.nsOf(node);
        const auto name = source_.nameOf(node);
        const auto attrs = source_.attrsOf(node);
        const auto uri = ns == ElementNs::Custom ? source_.uriOf(node) : std::string();
        const bool nestedHost = source_.isNestedHost(node);
        const uint32_t childScope = nestedHost ? source_.childScopeIdOf(node) : 0;
        if (nestedHost && childScope >= 2) {
          notePublishedNested(childScope);
        }
        builder_.nodeNewElement(id, ns, name, attrs, uri, nestedHost, childScope);
        table_.createElementRow(id, name, attrs, ns, uri);
        ++pendingNewNodes_;
        createdThisTick_.insert(node);
        indexForm(node);
        break;
      }
      case NodeKind::Text: {
        const auto v = source_.valueOf(node);
        builder_.nodeNewText(id, v);
        table_.createLeafRow(id, NodeKind::Text, v);
        ++pendingNewNodes_;
        createdThisTick_.insert(node);
        break;
      }
      case NodeKind::Comment: {
        const auto v = source_.valueOf(node);
        builder_.nodeNewComment(id, v);
        table_.createLeafRow(id, NodeKind::Comment, v);
        ++pendingNewNodes_;
        createdThisTick_.insert(node);
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
        uint8_t flags = source_.shadowInitFlagsOf(node);
        builder_.nodeNewShadowRoot(id, hostId, mode, flags);
        table_.createShadowRootRow(id, hostId, mode, flags);
        ++pendingNewNodes_;
        createdThisTick_.insert(node);
        break;
      }
      default:
        break;
    }
  }

  void describe(const void* node) {
    emitNodeNew(node, mint(node, KeySpace::Node));
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
    emitInsert(parentId, kInsertAtEnd, batch);
  }

  void describeAndInsertChildren(const void* parent, uint32_t parentId) {
    std::vector<uint32_t> batch;
    const void* first = nullptr;
    const void* last = nullptr;
    for (const void* child : source_.childrenOf(parent)) {
      if (source_.isUaOwned(child)) continue;
      if (awaitingChildScope(child)) {
        notePendingHost(parent, child);
        continue;
      }
      if (visitedThisTick_.count(child)) continue;
      uint32_t id = ids_.idOf(child, KeySpace::Node);
      const Row* row = id != kNone ? table_.getRow(id) : nullptr;
      if (!row || row->kind != static_cast<uint32_t>(source_.kindOf(child))) {
        ensureDescribed(child);
        id = ids_.idOf(child, KeySpace::Node);
        if (id == kNone || !table_.getRow(id)) continue;
      }
      visitedThisTick_.insert(child);
      if (!first) first = child;
      last = child;
      batch.push_back(id);
    }
    if (batch.empty()) return;
    emitInsert(parentId, last ? beforeIdOf(parent, last) : kInsertAtEnd, batch);
  }

  struct PendingHost {
    const void* parent;
    const void* node;
  };

  struct PendingInsert {
    const void* parent;
    const void* node;
  };

  struct PendingRemove {
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
  std::vector<PendingRemove> pendingRemoves_;
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
  uint32_t lastInsertIdCount_ = 0;
  uint32_t lastInsertOpCount_ = 0;
  uint32_t pendingNewNodes_ = 0;
  uint32_t gcClock_ = 0;
  uint32_t creditFrames_ = kCreditFramesDefault;
  uint32_t creditBytes_ = kCreditBytesDefault;
  std::vector<std::vector<uint8_t>> lastFrameParts_;
  std::vector<uint32_t> lastPublishedNestedIds_;
  std::unordered_set<const void*> createdThisTick_;
  std::unordered_set<const void*> visitedThisTick_;
  std::unordered_map<const void*, std::vector<std::string>> dirtyAttrs_;
  std::unordered_set<const void*> dirtyText_;
  std::vector<const void*> formIndex_;
};

}  // namespace speculum
