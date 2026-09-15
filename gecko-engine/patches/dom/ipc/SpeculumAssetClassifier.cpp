/* Speculum — classificador de ativo. Sem Firefox no teste de dest. */
#include "SpeculumAssetClassifier.h"

#include "mozilla/EndianUtils.h"
#include "nsString.h"
#include "nsTArray.h"

#include <cstring>

using mozilla::LittleEndian;

bool SpeculumAssetCanExit(SpeculumAssetDest aDest) {
  switch (aDest) {
    case SpeculumAssetDest::Image:
    case SpeculumAssetDest::Font:
    case SpeculumAssetDest::Audio:
    case SpeculumAssetDest::Video:
    case SpeculumAssetDest::Hls:
      return true;
    default:
      return false;
  }
}

SpeculumAssetDest SpeculumAssetDestFromFetch(const nsACString& aDestination) {
  if (aDestination.EqualsLiteral("image")) {
    return SpeculumAssetDest::Image;
  }
  if (aDestination.EqualsLiteral("font")) {
    return SpeculumAssetDest::Font;
  }
  if (aDestination.EqualsLiteral("audio")) {
    return SpeculumAssetDest::Audio;
  }
  if (aDestination.EqualsLiteral("video")) {
    return SpeculumAssetDest::Video;
  }
  if (aDestination.EqualsLiteral("script")) {
    return SpeculumAssetDest::Js;
  }
  if (aDestination.EqualsLiteral("style")) {
    return SpeculumAssetDest::Css;
  }
  if (aDestination.EqualsLiteral("websocket")) {
    return SpeculumAssetDest::Ws;
  }
  if (aDestination.EqualsLiteral("document") ||
      aDestination.EqualsLiteral("frame") ||
      aDestination.EqualsLiteral("iframe") ||
      aDestination.EqualsLiteral("embed") ||
      aDestination.EqualsLiteral("object") ||
      aDestination.EqualsLiteral("manifest") ||
      aDestination.EqualsLiteral("report")) {
    return SpeculumAssetDest::Html;
  }
  if (aDestination.IsEmpty()) {
    return SpeculumAssetDest::Xhr;
  }
  return SpeculumAssetDest::Unknown;
}

bool SpeculumAssetDecodeRequest(const uint8_t* aData, size_t aLength,
                                SpeculumAssetDest* aDest, nsACString& aUrl,
                                nsACString& aRange) {
  if (!aData || aLength < 5 || !aDest) {
    return false;
  }
  *aDest = static_cast<SpeculumAssetDest>(aData[0]);
  const uint32_t urlLen = LittleEndian::readUint32(aData + 1);
  if (aLength < 5u + urlLen + 4u) {
    return false;
  }
  aUrl.Assign(reinterpret_cast<const char*>(aData + 5), urlLen);
  const uint32_t rangeLen = LittleEndian::readUint32(aData + 5 + urlLen);
  if (aLength < 9u + urlLen + rangeLen) {
    return false;
  }
  aRange.Assign(reinterpret_cast<const char*>(aData + 9 + urlLen), rangeLen);
  return true;
}

bool SpeculumAssetDecodeWire(const uint8_t* aPayload, size_t aLength,
                             SpeculumAssetWire* aOut) {
  if (!aPayload || !aOut || aLength < 17) {
    return false;
  }
  aOut->streamId = LittleEndian::readUint32(aPayload);
  aOut->phase = aPayload[4];
  aOut->offset = LittleEndian::readUint64(aPayload + 5);
  aOut->dataLen = LittleEndian::readUint32(aPayload + 13);
  if (aLength < 17u + aOut->dataLen) {
    return false;
  }
  aOut->data = aPayload + 17;
  return true;
}

void SpeculumAssetEncodeWire(uint32_t aStreamId, uint8_t aPhase, uint64_t aOffset,
                             const uint8_t* aData, uint32_t aDataLen,
                             nsTArray<uint8_t>& aOut) {
  aOut.SetLength(17 + aDataLen);
  LittleEndian::writeUint32(aOut.Elements(), aStreamId);
  aOut[4] = aPhase;
  LittleEndian::writeUint64(aOut.Elements() + 5, aOffset);
  LittleEndian::writeUint32(aOut.Elements() + 13, aDataLen);
  if (aDataLen && aData) {
    memcpy(aOut.Elements() + 17, aData, aDataLen);
  }
}
