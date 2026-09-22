#pragma once

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <unordered_map>
#include <vector>

#include "domain/ids/Ids.hpp"

namespace speculum {

struct DocumentRecord {
  DocumentId id{};
  ProcessId process{};
};

class Documents {
 public:
  void install(DocumentId id, ProcessId process) {
    assert(id.valid());
    assert(process.valid());
    assert(by_id_.find(key(id)) == by_id_.end());
    by_id_[key(id)] = DocumentRecord{id, process};
    by_process_[process.value()].push_back(id);
  }

  void discard(DocumentId id) {
    auto it = by_id_.find(key(id));
    if (it == by_id_.end()) return;
    ProcessId p = it->second.process;
    by_id_.erase(it);
    auto& list = by_process_[p.value()];
    list.erase(std::remove(list.begin(), list.end(), id), list.end());
    if (list.empty()) by_process_.erase(p.value());
  }

  std::vector<DocumentId> discardAllOfProcess(ProcessId process) {
    std::vector<DocumentId> gone;
    auto it = by_process_.find(process.value());
    if (it == by_process_.end()) return gone;
    gone = it->second;
    by_process_.erase(it);
    for (auto id : gone) by_id_.erase(key(id));
    return gone;
  }

  const DocumentRecord* find(DocumentId id) const {
    auto it = by_id_.find(key(id));
    return it == by_id_.end() ? nullptr : &it->second;
  }

  // liveHosts / liveProcesses: predicates — every doc must have living host + process.
  template <class HostAlive, class ProcAlive>
  bool checkInvariants(HostAlive&& hostAlive, ProcAlive&& procAlive) const {
    for (const auto& [k, rec] : by_id_) {
      (void)k;
      if (!rec.id.valid()) return false;
      if (!hostAlive(rec.id.host)) return false;
      if (!procAlive(rec.process)) return false;
      if (rec.id.generation.value == 0) return false;
    }
    return true;
  }

  bool checkInvariants() const {
    // Without external liveness: structural only.
    for (const auto& [k, rec] : by_id_) {
      (void)k;
      if (!rec.id.valid() || !rec.process.valid()) return false;
    }
    return true;
  }

  std::size_t size() const { return by_id_.size(); }

  template <class F>
  void forEach(F&& f) const {
    for (const auto& [k, rec] : by_id_) {
      (void)k;
      f(rec);
    }
  }

 private:
  static uint64_t key(DocumentId id) {
    return (uint64_t(id.host.value()) << 32) | id.generation.value;
  }

  std::unordered_map<uint64_t, DocumentRecord> by_id_;
  std::unordered_map<uint32_t, std::vector<DocumentId>> by_process_;
};

}  // namespace speculum
