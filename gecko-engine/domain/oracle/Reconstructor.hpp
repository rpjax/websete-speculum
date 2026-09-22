#pragma once

#include "domain/oracle/Types.hpp"
#include "ports/IReconstructor.hpp"

namespace speculum::oracle {

// Pure inverse: TableImage → NaiveImage. No motor headers.
class Reconstructor final : public IReconstructor {
 public:
  NaiveImage reconstruct(const TableImage& table) const override {
    NaiveImage out;
    out.host = table.host;
    out.nodes = table.nodes;  // inert copy — topology already in image
    return out;
  }
};

}  // namespace speculum::oracle
