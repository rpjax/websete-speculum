#pragma once

#include <algorithm>
#include <vector>

#include "domain/ids/Ids.hpp"
#include "engines/sim/SimDocument.hpp"
#include "ports/IEngineProcess.hpp"

namespace speculum::sim {

class SimProcess final : public IEngineProcess {
 public:
  explicit SimProcess(ProcessId id) : id_(id) {}

  ProcessId id() const override { return id_; }

  uint32_t documentCount() const override { return uint32_t(docs_.size()); }
  DocumentId documentAt(uint32_t index) const override {
    if (index >= docs_.size()) return {};
    return docs_[index]->id();
  }

  void addDocument(SimDocument* doc) { docs_.push_back(doc); }
  void removeDocument(DocumentId id) {
    docs_.erase(std::remove_if(docs_.begin(), docs_.end(),
                                [&](SimDocument* d) { return d->id() == id; }),
                docs_.end());
  }
  bool owns(DocumentId id) const {
    for (auto* d : docs_)
      if (d->id() == id) return true;
    return false;
  }

 private:
  ProcessId id_;
  std::vector<SimDocument*> docs_;
};

}  // namespace speculum::sim
