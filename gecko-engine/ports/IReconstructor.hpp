#pragma once

#include "domain/oracle/Types.hpp"

namespace speculum {

// Pure: table → inert structure. Zero motor / IDocumentView.
class IReconstructor {
 public:
  virtual ~IReconstructor() = default;
  virtual oracle::NaiveImage reconstruct(const oracle::TableImage&) const = 0;
};

}  // namespace speculum
