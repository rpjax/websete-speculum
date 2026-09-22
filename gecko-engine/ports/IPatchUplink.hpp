#pragma once

#include <cstdint>
#include <span>

#include "domain/ids/Ids.hpp"
#include "domain/producer/Types.hpp"

namespace speculum {

class IPatchUplink {
 public:
  virtual ~IPatchUplink() = default;

  virtual void publish(DocumentId doc, uint32_t sequence,
                       std::span<const uint8_t> patch) = 0;
  virtual void publishSnapshot(DocumentId doc, CorrelationId corr,
                               const producer::SnapshotHeader& header,
                               std::span<const uint8_t> body) = 0;
  virtual bool isDrained() const = 0;
};

}  // namespace speculum
