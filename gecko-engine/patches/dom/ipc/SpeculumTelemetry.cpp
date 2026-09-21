/* Speculum — monta 0x05 só com events on. */
#include "SpeculumTelemetry.h"

#include "SpeculumCaps.h"
#include "SpeculumProjectionRuntime.h"
#include "mozilla/Assertions.h"
#include "mozilla/EndianUtils.h"
#include "mozilla/dom/ContentChild.h"
#include "nsTArray.h"
#include "nsXULAppAPI.h"

#include <cstdio>
#include <cstring>

using mozilla::LittleEndian;
using mozilla::dom::ContentChild;

void SpeculumEmitBytes(uint32_t aContextId, SpeculumCatalog aId,
                       const uint8_t* aData, uint32_t aLen) {
  if (!SpeculumEventsOn()) {
    return;
  }
  nsTArray<uint8_t> wire;
  wire.SetLength(2 + aLen);
  LittleEndian::writeUint16(wire.Elements(), static_cast<uint16_t>(aId));
  if (aLen && aData) {
    memcpy(wire.Elements() + 2, aData, aLen);
  }
  if (XRE_IsContentProcess()) {
    if (ContentChild* cc = ContentChild::GetSingleton()) {
      (void)cc->SendSpeculumTelemetry(aContextId, wire);
    }
    return;
  }
  SpeculumProjectionRuntime::Get().DeliverTelemetry(aContextId, wire);
}

void SpeculumEmitFrameEmitted(uint32_t aContextId, uint32_t aSequence,
                              uint32_t aGeneration, uint32_t aBytes,
                              uint32_t aOpCount, uint32_t aTableSize,
                              uint32_t aIdentitySize, uint32_t aBuildMs,
                              uint32_t aEncodeMs, uint32_t aDropped,
                              bool aResync) {
  if (!SpeculumEventsOn()) {
    return;
  }
  uint8_t buf[4 * 9 + 1];
  uint8_t* p = buf;
  auto wu32 = [&](uint32_t v) {
    LittleEndian::writeUint32(p, v);
    p += 4;
  };
  wu32(aSequence);
  wu32(aGeneration);
  wu32(aBytes);
  wu32(aOpCount);
  wu32(aTableSize);
  wu32(aIdentitySize);
  wu32(aBuildMs);
  wu32(aEncodeMs);
  wu32(aDropped);
  *p++ = aResync ? 1 : 0;
  SpeculumEmitBytes(aContextId, SpeculumCatalog::FrameEmitted, buf,
                    static_cast<uint32_t>(p - buf));
}

void SpeculumEmitResync(uint32_t aContextId, uint8_t aForce, bool aOk) {
  if (!SpeculumEventsOn()) {
    return;
  }
  const uint8_t buf[2] = {aForce, static_cast<uint8_t>(aOk ? 1 : 0)};
  SpeculumEmitBytes(aContextId,
                    aOk ? SpeculumCatalog::ResyncCompleted
                        : SpeculumCatalog::ResyncFailed,
                    buf, 2);
}

void SpeculumEmitInput(uint32_t aContextId, uint8_t aType, bool aAdmitted) {
  if (!SpeculumEventsOn()) {
    return;
  }
  const uint8_t buf[1] = {aType};
  SpeculumEmitBytes(aContextId,
                    aAdmitted ? SpeculumCatalog::InputAdmitted
                              : SpeculumCatalog::InputRejected,
                    buf, 1);
}

void SpeculumEmitProducerFault(uint32_t aContextId, const char* aCode,
                               const char* aPhase) {
  if (!SpeculumEventsOn() || !aCode || !aPhase) {
    return;
  }
  const uint32_t codeLen = static_cast<uint32_t>(strlen(aCode));
  const uint32_t phaseLen = static_cast<uint32_t>(strlen(aPhase));
  nsTArray<uint8_t> buf;
  buf.SetLength(8 + codeLen + phaseLen);
  LittleEndian::writeUint32(buf.Elements(), codeLen);
  memcpy(buf.Elements() + 4, aCode, codeLen);
  LittleEndian::writeUint32(buf.Elements() + 4 + codeLen, phaseLen);
  memcpy(buf.Elements() + 8 + codeLen, aPhase, phaseLen);
  SpeculumEmitBytes(aContextId, SpeculumCatalog::ProducerFault, buf.Elements(),
                    buf.Length());
}

namespace {
thread_local uint32_t gFatalContextId = 0;
}

void SpeculumSetFatalContext(uint32_t aContextId) {
  gFatalContextId = aContextId;
}

[[noreturn]] void SpeculumProducerAbort(const char* aMsg) {
  const char* code = "producer_invariant";
  const char* phase = "emit";
  if (aMsg && strstr(aMsg, "MAX_ROWS")) {
    code = "max_rows";
    phase = "allocate";
  }
  SpeculumEmitProducerFault(gFatalContextId, code, phase);
  fprintf(stderr, "[SPECULUM-PRODUCER-FATAL] %s\n", aMsg ? aMsg : "");
  MOZ_CRASH("SpeculumProducerAbort");
}
