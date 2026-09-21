/* Speculum — Kind 0x05. Off não aloca. */
#ifndef DOM_IPC_SPECULUMTELEMETRY_H_
#define DOM_IPC_SPECULUMTELEMETRY_H_

#include <stdint.h>

enum class SpeculumCatalog : uint16_t {
  FrameEmitted = 1,
  ResyncRequested = 2,
  ResyncCompleted = 3,
  ResyncFailed = 4,
  ProducerFault = 5,
  InputAdmitted = 6,
  InputRejected = 7,
};

void SpeculumEmitBytes(uint32_t aContextId, SpeculumCatalog aId,
                       const uint8_t* aData, uint32_t aLen);

void SpeculumEmitFrameEmitted(uint32_t aContextId, uint32_t aSequence,
                              uint32_t aGeneration, uint32_t aBytes,
                              uint32_t aOpCount, uint32_t aTableSize,
                              uint32_t aIdentitySize, uint32_t aBuildMs,
                              uint32_t aEncodeMs, uint32_t aDropped,
                              bool aResync);

void SpeculumEmitResync(uint32_t aContextId, uint8_t aForce, bool aOk);

void SpeculumEmitInput(uint32_t aContextId, uint8_t aType, bool aAdmitted);

void SpeculumEmitProducerFault(uint32_t aContextId, const char* aCode,
                               const char* aPhase);

void SpeculumSetFatalContext(uint32_t aContextId);
[[noreturn]] void SpeculumProducerAbort(const char* aMsg);

#endif
