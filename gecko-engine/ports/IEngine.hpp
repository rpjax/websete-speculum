#pragma once

#include "domain/Result.hpp"
#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

class IEngineHost;
class IEngineProcess;
class IEngineObserver;

class IEngine {
 public:
  virtual ~IEngine() = default;

  virtual Result<ViewportId> openViewport(Extent, HostId* outRoot) = 0;
  virtual Result<void> closeViewport(ViewportId) = 0;
  virtual IEngineHost* frame(HostId) = 0;
  virtual IEngineProcess* process(ProcessId) = 0;
  virtual void attach(IEngineObserver*) = 0;
};

}  // namespace speculum
