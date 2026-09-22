#pragma once

#include "domain/ids/Ids.hpp"

namespace speculum {

class IEngineProcess;

class IEngineObserver {
 public:
  virtual ~IEngineObserver() = default;

  virtual void onProcessGone(const IEngineProcess&) = 0;
};

}  // namespace speculum
