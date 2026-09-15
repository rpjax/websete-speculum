/* Speculum — um canal no pai, N leitores. Sem segundo GET à origem. */
#ifndef DOM_IPC_SPECULUMASSETREGISTRY_H_
#define DOM_IPC_SPECULUMASSETREGISTRY_H_

#include "nsString.h"

#include <cstdint>
#include <functional>

class SpeculumAssetRegistry {
 public:
  using Emit = std::function<void(uint32_t, const uint8_t*, uint32_t)>;

  static SpeculumAssetRegistry& Get();

  void OnConsumerRequest(uint32_t aContextId, const uint8_t* aPayload,
                         size_t aLength, const Emit& aEmit);
  void NoteChannelBytes(uint32_t aContextId, const nsACString& aUrl,
                        const nsACString& aRange, uint64_t aOffset,
                        const uint8_t* aData, uint32_t aLength, bool aDone);

 private:
  SpeculumAssetRegistry() = default;
};

#endif
