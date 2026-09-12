/* Speculum — destino de frames no processo pai (socket supervisor ou devpath). */
#ifndef dom_ipc_SpeculumFrameSink_h
#define dom_ipc_SpeculumFrameSink_h

#include "base/process_util.h"
#include "nsTArray.h"

class SpeculumFrameSink {
 public:
  virtual ~SpeculumFrameSink() = default;

  virtual void DeliverFrame(uint32_t aContextId, uint64_t aDocToken,
                            uint32_t aSequence, base::ProcessId aChildPid,
                            nsTArray<uint8_t>& aFrame) = 0;
};

SpeculumFrameSink& GetSpeculumFrameSink();

#endif
