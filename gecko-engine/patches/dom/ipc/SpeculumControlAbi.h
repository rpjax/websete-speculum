/* Speculum — codec binário do plano de controle (doc 18). */
#ifndef dom_ipc_SpeculumControlAbi_h
#define dom_ipc_SpeculumControlAbi_h

#include "nsStringFwd.h"

#include <stddef.h>
#include <stdint.h>

enum class SpeculumControlOpCode : uint16_t {
  // supervisor -> browser
  ContextCreate = 0x0101,
  ContextDestroy = 0x0102,
  Navigate = 0x0103,
  Reload = 0x0104,
  Stop = 0x0105,
  HistoryGo = 0x0106,
  ViewportSet = 0x0107,
  Input = 0x0108,
  Resync = 0x0109,
  DialogRespond = 0x010a,
  PermissionRespond = 0x010b,
    DownloadRespond = 0x010c,
    HaltClocks = 0x010d,
    ResumeClocks = 0x010e,
    FlushFrame = 0x010f,
    Snapshot = 0x0110,
    Shutdown = 0x01ff,

  // browser -> supervisor
  Ready = 0x0201,
  Heartbeat = 0x0202,
  ContextCreated = 0x0203,
  ContextDestroyed = 0x0204,
  Navigated = 0x0205,
  LoadStateChanged = 0x0206,
  DialogRequested = 0x0207,
  PermissionRequested = 0x0208,
    DownloadRequested = 0x0209,
    SnapshotServed = 0x020a,
    Fault = 0x02ff,
};

constexpr size_t kSpeculumControlHeaderBytes = sizeof(uint16_t) + sizeof(uint32_t);

class SpeculumControlReader {
 public:
  SpeculumControlReader(const uint8_t* aData, size_t aLength);

  bool Ok() const { return mOk; }
  uint16_t OpCode() const { return mOpCode; }
  uint32_t CorrelationId() const { return mCorrelationId; }

  bool ReadUInt8(uint8_t* aOut);
  bool ReadUInt16(uint16_t* aOut);
  bool ReadInt32(int32_t* aOut);
  bool ReadUInt32(uint32_t* aOut);
  bool ReadUInt64(uint64_t* aOut);
  bool ReadString(nsACString& aOut);
  bool ReadBytes(nsACString& aOut);

 private:
  bool Require(size_t aBytes);

  const uint8_t* mData;
  size_t mLength;
  size_t mPos;
  bool mOk;
  uint16_t mOpCode;
  uint32_t mCorrelationId;
};

class SpeculumControlWriter {
 public:
  SpeculumControlWriter(uint8_t* aBuffer, size_t aCapacity,
                        SpeculumControlOpCode aOpCode, uint32_t aCorrelationId);

  bool Ok() const { return mOk; }
  size_t Length() const { return mPos; }

  bool WriteUInt8(uint8_t aValue);
  bool WriteUInt16(uint16_t aValue);
  bool WriteInt32(int32_t aValue);
  bool WriteUInt32(uint32_t aValue);
  bool WriteUInt64(uint64_t aValue);
  bool WriteString(const nsACString& aValue);
  bool WriteBytes(const nsACString& aValue);

 private:
  bool Ensure(size_t aBytes);

  uint8_t* mBuffer;
  size_t mCapacity;
  size_t mPos;
  bool mOk;
};

#endif
