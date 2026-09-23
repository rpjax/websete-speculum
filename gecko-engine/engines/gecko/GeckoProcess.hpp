#pragma once

#include <algorithm>
#include <vector>

#include "domain/ids/Ids.hpp"
#include "engines/gecko/CssomTable.hpp"
#include "engines/gecko/GeckoDocument.hpp"
#include "ports/IEngineProcess.hpp"

namespace speculum::gecko {

class GeckoProcess final : public IEngineProcess {
 public:
  explicit GeckoProcess(ProcessId id) : id_(id) {}

  ProcessId id() const override { return id_; }
  uint32_t documentCount() const override { return uint32_t(docs_.size()); }
  DocumentId documentAt(uint32_t index) const override {
    if (index >= docs_.size()) return {};
    return docs_[index]->id();
  }

  CssomTable& cssom() { return cssom_; }
  const CssomTable& cssom() const { return cssom_; }

  void addDocument(GeckoDocument* doc) { docs_.push_back(doc); }
  void removeDocument(DocumentId id) {
    docs_.erase(std::remove_if(docs_.begin(), docs_.end(),
                                [&](GeckoDocument* d) { return d->id() == id; }),
                docs_.end());
  }

 private:
  ProcessId id_;
  std::vector<GeckoDocument*> docs_;
  CssomTable cssom_;  // process-owned (ITERACAO-06 A1)
};

}  // namespace speculum::gecko
