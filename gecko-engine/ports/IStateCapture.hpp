#pragma once

#include "domain/Result.hpp"
#include "domain/ids/Ids.hpp"
#include "domain/oracle/Types.hpp"

namespace speculum {

class IStateCapture {
 public:
  virtual ~IStateCapture() = default;
  virtual Result<oracle::TableImage> captureTable(oracle::FreezeToken,
                                                    HostId) = 0;
  virtual Result<oracle::NaiveImage> captureNaive(oracle::FreezeToken,
                                                    HostId) = 0;
  virtual Result<oracle::DescriptorImage> captureLive(oracle::FreezeToken,
                                                        HostId) = 0;
};

}  // namespace speculum
