#pragma once

#include "domain/Result.hpp"
#include "domain/oracle/Types.hpp"
#include "ports/IClock.hpp"

namespace speculum {

class IStateFreezer {
 public:
  virtual ~IStateFreezer() = default;
  // Fails with HaltIncomplete if not all hosts confirm.
  virtual Result<oracle::FreezeToken> freezeAll(Millis timeout) = 0;
  virtual void thawAll(oracle::FreezeToken) = 0;
  virtual uint32_t frozenCount() const = 0;
  virtual uint32_t expectedCount() const = 0;
};

}  // namespace speculum
