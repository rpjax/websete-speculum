#pragma once

#include <cstdint>
#include <string_view>

#include "domain/Result.hpp"
#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

class IEngineDocument;
class IHostObserver;

class IEngineHost {
 public:
  virtual ~IEngineHost() = default;

  virtual HostId id() const = 0;
  virtual Result<void> navigate(std::string_view url) = 0;
  virtual Result<void> reload(bool bypassCache) = 0;
  virtual Result<void> stop() = 0;
  virtual Result<void> historyGo(int32_t delta) = 0;
  virtual Result<void> resize(Extent) = 0;
  virtual const IEngineDocument* document() const = 0;
  virtual void attach(IHostObserver*) = 0;
};

}  // namespace speculum
