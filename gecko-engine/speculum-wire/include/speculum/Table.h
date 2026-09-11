// Speculum — tabela replicada de nós (frame-protocol.md §1.3–§1.5).
// Port de packages/page-projection/src/core/replicatedTable.ts. P0: "a tabela é a estrutura
// replicada; o DOM é uma projeção dela".
//
// Regras que NÃO são detalhe de implementação:
//  - a linha 1 (Document) nunca é armazenada e nunca contribui rowHash (§1.2/§5.8);
//  - tableHash é mantido por subtrai-antigo/soma-novo, O(1) por linha tocada (§1.5).
//    Recomputar em O(n) por frame é violação de contrato;
//  - `nextSiblingOf` / `lastChildOf` são índices DERIVADOS de navegação: não entram no hash
//    e não fazem parte do contrato (§1.4).
#pragma once
#include "speculum/Hash.h"
#include "speculum/Wire.h"

#include <algorithm>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace speculum {

inline constexpr uint32_t kNone = 0;

struct Row {
  uint32_t kind = 0;
  uint32_t parent = kNone;
  uint32_t prevSibling = kNone;
  uint64_t contentHash = 0;
  uint64_t rowHash = 0;
  // §1.3/§1.6 — `sequence` do frame em que a linha foi tocada por último. Não entra no hash.
  uint32_t lms = 0;
};

// Valor escalar de PROP_SET. A ISA selada só tem string e bool (propSet.ts).
struct PropValue {
  bool isBool = false;
  bool boolValue = false;
  std::string strValue;

  static PropValue str(std::string v) {
    PropValue p;
    p.strValue = std::move(v);
    return p;
  }
  static PropValue boolean(bool v) {
    PropValue p;
    p.isBool = true;
    p.boolValue = v;
    return p;
  }
  uint64_t hash(uint8_t propId) const {
    return isBool ? hashPropBool(propId, boolValue) : hashPropStr(propId, strValue);
  }
};

class ReplicatedTable {
 public:
  uint64_t tableHash() const { return tracker_.value(); }
  size_t size() const { return rows_.size(); }
  bool has(uint32_t id) const { return rows_.count(id) != 0; }

  const Row* getRow(uint32_t id) const {
    auto it = rows_.find(id);
    return it == rows_.end() ? nullptr : &it->second;
  }

  // Uma frame, um `lms` (§4 preâmbulo).
  void setSequence(uint32_t sequence) { currentSequence_ = sequence; }

  // §4.1 CHECK scope=1 — Σ rowHash em [lo, hi]. O(size) por ora; o modelo O(1) por bucket
  // é OPEN-3 e não está construído. Existe para que um CHECK de range seja avaliado de
  // verdade em vez de ignorado em silêncio (P7).
  uint64_t hashRange(uint32_t lo, uint32_t hi) const {
    uint64_t sum = 0;
    for (const auto& kv : rows_) {
      if (kv.first >= lo && kv.first <= hi) sum += kv.second.rowHash;
    }
    return sum;
  }

  // Filhos de `parent` em ordem (primeiro → último). Caminha lastChildOf + prevSibling e inverte.
  std::vector<uint32_t> orderedChildIds(uint32_t parent) const {
    std::vector<uint32_t> backwards;
    std::unordered_set<uint32_t> seen;
    uint32_t child = lastChild(parent);
    while (child != kNone) {
      if (!seen.insert(child).second) break;
      backwards.push_back(child);
      const Row* r = getRow(child);
      child = r ? r->prevSibling : kNone;
    }
    std::reverse(backwards.begin(), backwards.end());
    return backwards;
  }

  uint32_t lastChildId(uint32_t parent) const { return lastChild(parent); }

  uint32_t shadowRootOf(uint32_t host) const {
    auto it = shadowRootByHost_.find(host);
    return it == shadowRootByHost_.end() ? kNone : it->second;
  }

  void reset() {
    rows_.clear();
    attrHashes_.clear();
    propHashes_.clear();
    propValues_.clear();
    nextSiblingOf_.clear();
    lastChildOf_.clear();
    shadowRootByHost_.clear();
    hostOfShadowRoot_.clear();
    tracker_.clear();
  }

  // ---- NODE_NEW (§4.2) — sempre cria linha destacada (parent=0, prevSibling=0). ----

  void createElementRow(uint32_t id, const std::string& tagName,
                        const std::vector<AttrPair>& attrs,
                        ElementNs ns = ElementNs::Html, const std::string& uri = "") {
    std::unordered_map<std::string, uint64_t> attrMap;
    uint64_t sum = hashName(tagName) + hashNs(static_cast<uint8_t>(ns), uri);
    for (const auto& a : attrs) {
      uint64_t h = hashAttr(a.name, a.value);
      attrMap[a.name] = h;
      sum += h;
    }
    attrHashes_[id] = std::move(attrMap);
    propHashes_[id];
    propValues_[id];
    setRow(id, static_cast<uint32_t>(NodeKind::Element), kNone, kNone, sum);
  }

  // TEXT/COMMENT (`value`) ou DOCTYPE (`name`) — um campo de conteúdo só.
  void createLeafRow(uint32_t id, NodeKind kind, const std::string& contentField) {
    setRow(id, static_cast<uint32_t>(kind), kNone, kNone, hashValue(contentField));
  }

  // SHADOW_ROOT — parent = host desde já, e NÃO entra na cadeia de luz do host.
  void createShadowRootRow(uint32_t id, uint32_t host, uint8_t mode, uint8_t initFlags) {
    setRow(id, static_cast<uint32_t>(NodeKind::ShadowRoot), host, kNone,
           hashShadowInit(mode, initFlags));
    shadowRootByHost_[host] = id;
    hostOfShadowRoot_[id] = host;
  }

  // ---- ATTR_SET / ATTR_DEL / TEXT_SET / PROP_SET (§4.4) — só conteúdo. ----

  void setAttrs(uint32_t id, const std::vector<AttrPair>& attrs) {
    Row* row = mutableRow(id);
    if (!row) return;
    auto& attrMap = attrHashes_[id];
    uint64_t sum = row->contentHash;
    for (const auto& a : attrs) {
      auto it = attrMap.find(a.name);
      if (it != attrMap.end()) sum -= it->second;
      uint64_t h = hashAttr(a.name, a.value);
      attrMap[a.name] = h;
      sum += h;
    }
    setRow(id, row->kind, row->parent, row->prevSibling, sum);
  }

  void delAttrs(uint32_t id, const std::vector<std::string>& names) {
    Row* row = mutableRow(id);
    if (!row) return;
    auto mapIt = attrHashes_.find(id);
    if (mapIt == attrHashes_.end()) return;
    auto& attrMap = mapIt->second;
    uint64_t sum = row->contentHash;
    for (const auto& n : names) {
      auto it = attrMap.find(n);
      if (it == attrMap.end()) continue;  // apagar atributo ausente é no-op (§4.4)
      sum -= it->second;
      attrMap.erase(it);
    }
    setRow(id, row->kind, row->parent, row->prevSibling, sum);
  }

  void setValue(uint32_t id, const std::string& value) {
    Row* row = mutableRow(id);
    if (!row) return;
    setRow(id, row->kind, row->parent, row->prevSibling, hashValue(value));
  }

  void setProp(uint32_t id, uint8_t propId, const PropValue& value) {
    Row* row = mutableRow(id);
    if (!row) return;
    auto& hashMap = propHashes_[id];
    auto& valueMap = propValues_[id];
    uint64_t sum = row->contentHash;
    auto it = hashMap.find(propId);
    if (it != hashMap.end()) sum -= it->second;
    uint64_t h = value.hash(propId);
    hashMap[propId] = h;
    valueMap[propId] = value;
    setRow(id, row->kind, row->parent, row->prevSibling, sum + h);
  }

  const PropValue* getProp(uint32_t id, uint8_t propId) const {
    auto m = propValues_.find(id);
    if (m == propValues_.end()) return nullptr;
    auto p = m->second.find(propId);
    return p == m->second.end() ? nullptr : &p->second;
  }

  // ---- INSERT / REMOVE (§4.3) — só topologia. ----

  // Desliga cada id de onde estiver (é um move), religa o lote em ordem de fio logo antes de
  // `before` (ou no fim, se before==0). Exatamente duas linhas mudam por ligação — nunca
  // O(filhos do pai).
  void insertBatch(uint32_t parent, uint32_t before, const std::vector<uint32_t>& ids) {
    uint32_t prev;
    if (before == kNone) {
      prev = lastChild(parent);
    } else {
      const Row* r = getRow(before);
      prev = r ? r->prevSibling : kNone;
    }
    for (uint32_t id : ids) {
      Row* existing = mutableRow(id);
      if (existing && existing->parent != kNone) unlink(id, *existing);
      linkAfter(id, parent, prev);
      prev = id;
    }
    if (before != kNone) {
      relinkPrevSibling(before, prev);
      if (prev != kNone) nextSiblingOf_[prev] = before;
    } else {
      lastChildOf_[parent] = prev;
    }
  }

  // `parent` é redundante com a tabela (§4.3 chama de "assert barato").
  void removeBatch(uint32_t /*parent*/, const std::vector<uint32_t>& ids) {
    for (uint32_t id : ids) {
      Row* row = mutableRow(id);
      if (!row) continue;
      Row copy = *row;
      unlink(id, copy);
      setRow(id, copy.kind, kNone, kNone, copy.contentHash);
    }
  }

  // NODE_DROP (§4.2) — remove permanentemente o estado contratual de uma linha.
  void dropRow(uint32_t id) {
    auto owned = shadowRootByHost_.find(id);
    if (owned != shadowRootByHost_.end()) hostOfShadowRoot_.erase(owned->second);
    shadowRootByHost_.erase(id);
    auto host = hostOfShadowRoot_.find(id);
    if (host != hostOfShadowRoot_.end()) shadowRootByHost_.erase(host->second);
    hostOfShadowRoot_.erase(id);
    rows_.erase(id);
    attrHashes_.erase(id);
    propHashes_.erase(id);
    propValues_.erase(id);
    nextSiblingOf_.erase(id);
    lastChildOf_.erase(id);
    tracker_.remove(id);
  }

  // NODE_DROP derruba a linha **e todos os descendentes** — linha destacada ainda pode ter
  // filhos. Devolve tudo que caiu para o chamador soltar a identidade correspondente.
  std::vector<uint32_t> dropSubtree(uint32_t id) {
    std::vector<uint32_t> ids;
    collectSubtreeIds(id, ids);
    for (uint32_t d : ids) dropRow(d);
    return ids;
  }

  std::vector<uint32_t> subtreeIds(uint32_t id) const {
    std::vector<uint32_t> ids;
    collectSubtreeIds(id, ids);
    return ids;
  }

  // Raízes destacadas (parent==0) com `lms` atrasado — candidatas da varredura de GC (§1.6).
  std::vector<uint32_t> collectDroppableIds(uint32_t currentSequence, uint32_t maxAge,
                                            size_t limit) const {
    std::vector<uint32_t> out;
    for (const auto& kv : rows_) {
      if (out.size() >= limit) break;
      if (kv.second.parent != kNone) continue;
      if (currentSequence - kv.second.lms >= maxAge) out.push_back(kv.first);
    }
    return out;
  }

 private:
  uint32_t lastChild(uint32_t parent) const {
    auto it = lastChildOf_.find(parent);
    return it == lastChildOf_.end() ? kNone : it->second;
  }

  uint32_t nextSibling(uint32_t id) const {
    auto it = nextSiblingOf_.find(id);
    return it == nextSiblingOf_.end() ? kNone : it->second;
  }

  Row* mutableRow(uint32_t id) {
    auto it = rows_.find(id);
    return it == rows_.end() ? nullptr : &it->second;
  }

  void setRow(uint32_t id, uint32_t kind, uint32_t parent, uint32_t prevSibling,
              uint64_t contentHash) {
    Row r;
    r.kind = kind;
    r.parent = parent;
    r.prevSibling = prevSibling;
    r.contentHash = contentHash;
    r.rowHash = computeRowHash(id, kind, parent, prevSibling, contentHash);
    r.lms = currentSequence_;
    rows_[id] = r;
    tracker_.upsert(id, r.rowHash);
  }

  void relinkPrevSibling(uint32_t id, uint32_t prevSibling) {
    Row* row = mutableRow(id);
    if (!row) return;
    setRow(id, row->kind, row->parent, prevSibling, row->contentHash);
  }

  void linkAfter(uint32_t id, uint32_t parent, uint32_t prevId) {
    const Row* row = getRow(id);
    uint32_t kind = row ? row->kind : static_cast<uint32_t>(NodeKind::Element);
    uint64_t contentHash = row ? row->contentHash : 0;
    setRow(id, kind, parent, prevId, contentHash);
    if (prevId != kNone) nextSiblingOf_[prevId] = id;
  }

  // Tira `id` da posição atual, consertando prevSibling do vizinho / lastChildOf.
  void unlink(uint32_t id, const Row& row) {
    if (row.parent == kNone) return;
    uint32_t nextId = nextSibling(id);
    nextSiblingOf_.erase(id);
    if (nextId != kNone) {
      relinkPrevSibling(nextId, row.prevSibling);
      if (row.prevSibling != kNone) nextSiblingOf_[row.prevSibling] = nextId;
    } else if (lastChild(row.parent) == id) {
      lastChildOf_[row.parent] = row.prevSibling;
      // O `next` derivado do anterior ainda apontava para `id` (o antigo último filho).
      // Deixar isso posto faz o próximo unlink dele pegar o ramo "tem next" e pular
      // lastChildOf — OPEN-8, o caso prepend+evict-da-cauda.
      if (row.prevSibling != kNone) nextSiblingOf_.erase(row.prevSibling);
    }
  }

  // DFS iterativa. Raiz primeiro; ordem do resto não especificada.
  void collectSubtreeIds(uint32_t rootId, std::vector<uint32_t>& out) const {
    std::vector<uint32_t> stack;
    std::unordered_set<uint32_t> visited;
    visited.insert(rootId);
    stack.push_back(rootId);
    while (!stack.empty()) {
      uint32_t id = stack.back();
      stack.pop_back();
      out.push_back(id);

      uint32_t child = lastChild(id);
      while (child != kNone) {
        if (!visited.insert(child).second) {
          throw std::runtime_error("ReplicatedTable: ciclo na caminhada de subarvore");
        }
        stack.push_back(child);
        const Row* r = getRow(child);
        child = r ? r->prevSibling : kNone;
      }

      auto sh = shadowRootByHost_.find(id);
      if (sh != shadowRootByHost_.end() && sh->second != id) {
        if (!visited.insert(sh->second).second) {
          throw std::runtime_error("ReplicatedTable: ciclo na caminhada de subarvore");
        }
        stack.push_back(sh->second);
      }
    }
  }

  std::unordered_map<uint32_t, Row> rows_;
  std::unordered_map<uint32_t, std::unordered_map<std::string, uint64_t>> attrHashes_;
  std::unordered_map<uint32_t, std::unordered_map<uint8_t, uint64_t>> propHashes_;
  std::unordered_map<uint32_t, std::unordered_map<uint8_t, PropValue>> propValues_;
  std::unordered_map<uint32_t, uint32_t> nextSiblingOf_;
  std::unordered_map<uint32_t, uint32_t> lastChildOf_;
  std::unordered_map<uint32_t, uint32_t> shadowRootByHost_;
  std::unordered_map<uint32_t, uint32_t> hostOfShadowRoot_;
  TableHashTracker tracker_;
  uint32_t currentSequence_ = 0;
};

}  // namespace speculum
