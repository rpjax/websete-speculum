#pragma once

#include "domain/ids/Ids.hpp"

namespace speculum {

class IEngineDocument;

class IEngineProcess {
 public:
  virtual ~IEngineProcess() = default;

  virtual ProcessId id() const = 0;
  virtual uint32_t documentCount() const = 0;
  virtual DocumentId documentAt(uint32_t index) const = 0;
};

}  // namespace speculum
