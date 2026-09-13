/* Speculum — codec binário do plano de controle (doc 18). */
#include "SpeculumControlAbi.h"

#include "mozilla/EndianUtils.h"

#include <cstring>

using mozilla::LittleEndian;

SpeculumControlReader::SpeculumControlReader(const uint8_t* aData,
                                               size_t aLength)
    : mData(aData),
      mLength(aLength),
      mPos(0),
      mOk(false),
      mOpCode(0),
      mCorrelationId(0) {
  if (!aData || aLength < kSpeculumControlHeaderBytes) {
    return;
  }
  mOk = true;
  if (!ReadUInt16(&mOpCode) || !ReadUInt32(&mCorrelationId)) {
    mOk = false;
    return;
  }
}

bool SpeculumControlReader::Require(size_t aBytes) {
  if (!mOk) {
    return false;
  }
  if (mPos + aBytes > mLength) {
    mOk = false;
    return false;
  }
  return true;
}

bool SpeculumControlReader::ReadUInt8(uint8_t* aOut) {
  if (!Require(sizeof(uint8_t))) {
    return false;
  }
  *aOut = mData[mPos++];
  return true;
}

bool SpeculumControlReader::ReadUInt16(uint16_t* aOut) {
  if (!Require(sizeof(uint16_t))) {
    return false;
  }
  *aOut = LittleEndian::readUint16(mData + mPos);
  mPos += sizeof(uint16_t);
  return true;
}

bool SpeculumControlReader::ReadInt32(int32_t* aOut) {
  if (!Require(sizeof(int32_t))) {
    return false;
  }
  *aOut = LittleEndian::readInt32(mData + mPos);
  mPos += sizeof(int32_t);
  return true;
}

bool SpeculumControlReader::ReadUInt32(uint32_t* aOut) {
  if (!Require(sizeof(uint32_t))) {
    return false;
  }
  *aOut = LittleEndian::readUint32(mData + mPos);
  mPos += sizeof(uint32_t);
  return true;
}

bool SpeculumControlReader::ReadUInt64(uint64_t* aOut) {
  if (!Require(sizeof(uint64_t))) {
    return false;
  }
  *aOut = LittleEndian::readUint64(mData + mPos);
  mPos += sizeof(uint64_t);
  return true;
}

bool SpeculumControlReader::ReadString(nsACString& aOut) {
  uint32_t byteCount = 0;
  if (!ReadUInt32(&byteCount)) {
    return false;
  }
  if (!Require(byteCount)) {
    return false;
  }
  aOut.Assign(reinterpret_cast<const char*>(mData + mPos), byteCount);
  mPos += byteCount;
  return true;
}

SpeculumControlWriter::SpeculumControlWriter(uint8_t* aBuffer, size_t aCapacity,
                                             SpeculumControlOpCode aOpCode,
                                             uint32_t aCorrelationId)
    : mBuffer(aBuffer),
      mCapacity(aCapacity),
      mPos(0),
      mOk(aBuffer && aCapacity >= kSpeculumControlHeaderBytes) {
  if (!mOk) {
    return;
  }
  if (!WriteUInt16(static_cast<uint16_t>(aOpCode)) ||
      !WriteUInt32(aCorrelationId)) {
    mOk = false;
  }
}

bool SpeculumControlWriter::Ensure(size_t aBytes) {
  if (!mOk) {
    return false;
  }
  if (mPos + aBytes > mCapacity) {
    mOk = false;
    return false;
  }
  return true;
}

bool SpeculumControlWriter::WriteUInt8(uint8_t aValue) {
  if (!Ensure(sizeof(uint8_t))) {
    return false;
  }
  mBuffer[mPos++] = aValue;
  return true;
}

bool SpeculumControlWriter::WriteUInt16(uint16_t aValue) {
  if (!Ensure(sizeof(uint16_t))) {
    return false;
  }
  LittleEndian::writeUint16(mBuffer + mPos, aValue);
  mPos += sizeof(uint16_t);
  return true;
}

bool SpeculumControlWriter::WriteInt32(int32_t aValue) {
  if (!Ensure(sizeof(int32_t))) {
    return false;
  }
  LittleEndian::writeInt32(mBuffer + mPos, aValue);
  mPos += sizeof(int32_t);
  return true;
}

bool SpeculumControlWriter::WriteUInt32(uint32_t aValue) {
  if (!Ensure(sizeof(uint32_t))) {
    return false;
  }
  LittleEndian::writeUint32(mBuffer + mPos, aValue);
  mPos += sizeof(uint32_t);
  return true;
}

bool SpeculumControlWriter::WriteUInt64(uint64_t aValue) {
  if (!Ensure(sizeof(uint64_t))) {
    return false;
  }
  LittleEndian::writeUint64(mBuffer + mPos, aValue);
  mPos += sizeof(uint64_t);
  return true;
}

bool SpeculumControlWriter::WriteString(const nsACString& aValue) {
  const uint32_t byteCount = static_cast<uint32_t>(aValue.Length());
  if (!WriteUInt32(byteCount)) {
    return false;
  }
  if (byteCount == 0) {
    return true;
  }
  if (!Ensure(byteCount)) {
    return false;
  }
  memcpy(mBuffer + mPos, aValue.Data(), byteCount);
  mPos += byteCount;
  return true;
}
