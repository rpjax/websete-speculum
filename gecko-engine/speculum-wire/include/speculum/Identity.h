// Speculum — mapa de identidade: objeto vivo -> id u32 da tabela replicada.
//
// Um mint, três espaços de chave (Node / Sheet / Rule). O id space é único
// (§1.1 / SEAL-CSSOM-P1-IDSPACE). As chaves não são: no Gecko o alocador
// reusa o endereço entre nsINode e StyleSheet/css::Rule. WeakMap no JS
// separa os objetos; aqui o espaço na chave faz o mesmo.
//
// Ids NUNCA são reaproveitados. Um id reemitido para outro nó corrompe a
// tabela do cliente em silêncio.
#pragma once
#include "speculum/Table.h"  // kNone

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace speculum {

enum class KeySpace : uint8_t { Node = 0, Sheet = 1, Rule = 2 };

struct IdentityKey {
  const void* ptr = nullptr;
  KeySpace space = KeySpace::Node;
  bool operator==(const IdentityKey& o) const {
    return ptr == o.ptr && space == o.space;
  }
};

struct IdentityKeyHash {
  size_t operator()(const IdentityKey& k) const {
    const auto p = static_cast<size_t>(reinterpret_cast<uintptr_t>(k.ptr));
    return p ^ (static_cast<size_t>(k.space) * static_cast<size_t>(0x9e3779b9));
  }
};

class IdentityMap {
 public:
  static constexpr uint32_t kFirstId = 2;

  uint32_t idOf(const void* ptr, KeySpace space) const {
    auto it = byKey_.find(IdentityKey{ptr, space});
    return it == byKey_.end() ? kNone : it->second;
  }

  // Testes com ponteiros únicos (um objeto, um espaço). Não usar no produtor
  // quando Node e CSSOM podem ter ocupado o mesmo endereço.
  uint32_t idOf(const void* ptr) const {
    const uint32_t node = idOf(ptr, KeySpace::Node);
    if (node != kNone) return node;
    const uint32_t sheet = idOf(ptr, KeySpace::Sheet);
    if (sheet != kNone) return sheet;
    return idOf(ptr, KeySpace::Rule);
  }

  IdentityKey keyOf(uint32_t id) const {
    auto it = byId_.find(id);
    return it == byId_.end() ? IdentityKey{} : it->second;
  }

  bool known(const void* ptr, KeySpace space) const {
    return byKey_.count(IdentityKey{ptr, space}) != 0;
  }

  uint32_t assign(const void* ptr, KeySpace space) {
    IdentityKey key{ptr, space};
    auto it = byKey_.find(key);
    if (it != byKey_.end()) return it->second;
    uint32_t id = nextId_++;
    byKey_[key] = id;
    byId_[id] = key;
    return id;
  }

  uint32_t release(const void* ptr, KeySpace space) {
    IdentityKey key{ptr, space};
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

  void clear() {
    byKey_.clear();
    byId_.clear();
    nextId_ = kFirstId;
  }

  std::vector<uint32_t> allIds() const {
    std::vector<uint32_t> out;
    out.reserve(byId_.size());
    for (const auto& kv : byId_) out.push_back(kv.first);
    std::sort(out.begin(), out.end());
    return out;
  }

 private:
  std::unordered_map<IdentityKey, uint32_t, IdentityKeyHash> byKey_;
  std::unordered_map<uint32_t, IdentityKey> byId_;
  uint32_t nextId_ = kFirstId;
};

}  // namespace speculum
