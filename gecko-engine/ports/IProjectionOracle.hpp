#pragma once

#include "domain/oracle/Types.hpp"

namespace speculum {

class IProjectionOracle {
 public:
  virtual ~IProjectionOracle() = default;
  virtual oracle::Verdict run(oracle::FreezeToken) = 0;
};

}  // namespace speculum
