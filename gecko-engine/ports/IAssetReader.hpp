#pragma once

#include <cstdint>
#include <string_view>

#include "domain/Result.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

using StreamId = uint32_t;

// Minimal asset port (Fase 5 stub — full assets later).
class IAssetReader {
 public:
  virtual ~IAssetReader() = default;
  virtual Result<void> open(StreamId id, std::string_view url, DocumentId doc) = 0;
  virtual Result<void> cancel(StreamId id) = 0;
};

}  // namespace speculum
