/* Speculum — ponte de controle com o supervisor (doc 12); frames trafegam aqui. */
#ifndef dom_ipc_SpeculumSupervisorLink_h
#define dom_ipc_SpeculumSupervisorLink_h

#include "base/process_util.h"
#include "nsTArray.h"

class SpeculumSupervisorLink {
 public:
  virtual ~SpeculumSupervisorLink() = default;

  virtual void DeliverFrame(uint32_t aContextId, uint64_t aDocToken,
                            uint32_t aSequence, base::ProcessId aChildPid,
                            nsTArray<uint8_t>& aFrame) = 0;

  // Envelope kind 0x02 (Event), payload binário de controle (doc 18).
  virtual void SendBrowserEvent(uint32_t aContextId, const char* aPayload,
                                uint32_t aPayloadLength) {}
};

void InitSpeculumSupervisorLink();
SpeculumSupervisorLink& GetSpeculumSupervisorLink();

#endif
