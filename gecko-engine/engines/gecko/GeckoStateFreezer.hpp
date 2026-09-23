#pragma once

#include <cstdint>
#include <set>
#include <vector>

#include "domain/Result.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/oracle/Types.hpp"
#include "engines/gecko/GeckoEngine.hpp"
#include "ports/IStateFreezer.hpp"

namespace speculum::gecko {

class GeckoStateFreezer final : public IStateFreezer {
 public:
  explicit GeckoStateFreezer(GeckoEngine& eng) : eng_(eng) {}

  void refuseConfirm(HostId h) { refuse_.insert(h.value()); }

  Result<oracle::FreezeToken> freezeAll(Millis) override {
    if (token_ != 0) thawAll(token_);
    expected_ = 0;
    frozen_ = 0;
    std::vector<HostId> live;
    eng_.hosts().forEach([&](const HostNode& n) {
      live.push_back(n.id);
      ++expected_;
    });
    for (auto h : live) {
      if (refuse_.count(h.value())) continue;
      if (auto* prod = producerFor(h)) prod->patchClock().halt();
      ++frozen_;
    }
    if (frozen_ != expected_) {
      for (auto h : live) {
        if (refuse_.count(h.value())) continue;
        if (auto* prod = producerFor(h)) prod->patchClock().resume();
      }
      frozen_ = expected_ = 0;
      return Result<oracle::FreezeToken>::failure(fault::makeFault(
          fault::FaultCode::HaltIncomplete, "GeckoStateFreezer",
          "not all hosts confirmed freeze"));
    }
    token_ = ++next_token_;
    return Result<oracle::FreezeToken>::success(token_);
  }

  void thawAll(oracle::FreezeToken t) override {
    if (t == 0 || t != token_) return;
    eng_.hosts().forEach([&](const HostNode& n) {
      if (auto* prod = producerFor(n.id)) prod->patchClock().resume();
    });
    token_ = frozen_ = expected_ = 0;
  }

  uint32_t frozenCount() const override { return frozen_; }
  uint32_t expectedCount() const override { return expected_; }
  bool isValid(oracle::FreezeToken t) const override { return t != 0 && t == token_; }

 private:
  producer::Producer* producerFor(HostId h) {
    auto* doc = eng_.geckoDocumentOf(h);
    if (!doc) return nullptr;
    return eng_.producerOf(doc->id());
  }

  GeckoEngine& eng_;
  oracle::FreezeToken token_{0};
  oracle::FreezeToken next_token_{0};
  uint32_t frozen_{0};
  uint32_t expected_{0};
  std::set<uint32_t> refuse_;
};

}  // namespace speculum::gecko
