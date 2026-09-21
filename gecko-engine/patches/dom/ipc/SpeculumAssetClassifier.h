/* Speculum — destino do pedido. Dúvida = recusa. */
#ifndef DOM_IPC_SPECULUMASSETCLASSIFIER_H_
#define DOM_IPC_SPECULUMASSETCLASSIFIER_H_

#include "nsStringFwd.h"
#include "nsTArray.h"

#include <stddef.h>
#include <stdint.h>

enum class SpeculumAssetDest : uint8_t {
  Unknown = 0,
  Image = 1,
  Font = 2,
  Audio = 3,
  Video = 4,
  Hls = 5,
  Html = 10,
  Js = 11,
  Css = 12,
  Xhr = 13,
  Sse = 14,
  Ws = 15,
};

bool SpeculumAssetCanExit(SpeculumAssetDest aDest);
SpeculumAssetDest SpeculumAssetDestFromFetch(const nsACString& aDestination);
bool SpeculumAssetDecodeRequest(const uint8_t* aData, size_t aLength,
                                SpeculumAssetDest* aDest, nsACString& aUrl,
                                nsACString& aRange);

struct SpeculumAssetWire {
  uint32_t streamId = 0;
  uint8_t phase = 0;
  uint64_t offset = 0;
  const uint8_t* data = nullptr;
  uint32_t dataLen = 0;
};

bool SpeculumAssetDecodeWire(const uint8_t* aPayload, size_t aLength,
                             SpeculumAssetWire* aOut);
void SpeculumAssetEncodeWire(uint32_t aStreamId, uint8_t aPhase, uint64_t aOffset,
                             const uint8_t* aData, uint32_t aDataLen,
                             nsTArray<uint8_t>& aOut);

#endif
