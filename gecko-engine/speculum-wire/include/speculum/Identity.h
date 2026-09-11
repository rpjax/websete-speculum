// Speculum — mapa de identidade: nó vivo -> id u32 da tabela replicada.
//
// A chave é opaca (`const void*`) de propósito: aqui é `nsINode*`, mas nada nesta camada
// sabe disso. O motor diz quando um nó morre (`NodeWillBeDestroyed` no Gecko) e esta classe
// despeja a entrada — por isso não é preciso segurar referência forte ao nó
// (`gecko-engine/02-costura-evidencia.md` §3).
//
// Ids NUNCA são reaproveitados. Um id reemitido para outro nó corrompe a tabela do cliente
// em silêncio: ele aplicaria conteúdo novo sobre uma linha que julga conhecer.
#pragma once
#include "speculum/Table.h"  // kNone

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace speculum {

class IdentityMap {
 public:
  // Id 1 é o Document e nunca é alocado (§1.2): a alocação começa em 2.
  static constexpr uint32_t kFirstId = 2;

  uint32_t idOf(const void* key) const {
    auto it = byKey_.find(key);
    return it == byKey_.end() ? kNone : it->second;
  }

  const void* keyOf(uint32_t id) const {
    auto it = byId_.find(id);
    return it == byId_.end() ? nullptr : it->second;
  }

  bool known(const void* key) const { return byKey_.count(key) != 0; }

  // Aloca id novo. Falha alto se a chave já tem id — silenciar isso esconde bug de dupla
  // descrição, que é exatamente o que vira dessincronia depois.
  uint32_t assign(const void* key) {
    auto it = byKey_.find(key);
    if (it != byKey_.end()) return it->second;
    uint32_t id = nextId_++;
    byKey_[key] = id;
    byId_[id] = key;
    return id;
  }

  // O motor avisou que o nó morreu. Só solta a entrada — não emite nada; quem decide o que
  // vai para o fio é o produtor.
  uint32_t release(const void* key) {
    auto it = byKey_.find(key);
    if (it == byKey_.end()) return kNone;
    uint32_t id = it->second;
    byKey_.erase(it);
    byId_.erase(id);
    return id;
  }

  void releaseId(uint32_t id) {
    auto it = byId_.find(id);
    if (it == byId_.end()) return;
    byKey_.erase(it->second);
    byId_.erase(it);
  }

  size_t size() const { return byKey_.size(); }
  uint32_t peekNextId() const { return nextId_; }

  // Resync forte (`resyncVirtual`, §5.8): joga o mapa fora. `generation` NÃO muda — os ids
  // são simplesmente reatribuídos do zero.
  void clear() {
    byKey_.clear();
    byId_.clear();
    nextId_ = kFirstId;
  }

  std::vector<uint32_t> allIds() const {
    std::vector<uint32_t> out;
    out.reserve(byId_.size());
    for (const auto& kv : byId_) out.push_back(kv.first);
    return out;
  }

 private:
  std::unordered_map<const void*, uint32_t> byKey_;
  std::unordered_map<uint32_t, const void*> byId_;
  uint32_t nextId_ = kFirstId;
};

}  // namespace speculum
