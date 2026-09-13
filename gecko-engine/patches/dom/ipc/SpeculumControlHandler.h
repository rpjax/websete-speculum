/* Speculum — ContextCreate/Destroy no processo pai (controle supervisor). */
#ifndef dom_ipc_SpeculumControlHandler_h
#define dom_ipc_SpeculumControlHandler_h

#include <stddef.h>
#include <stdint.h>

namespace mozilla::dom {
class ContentParent;
}

void SpeculumDispatchControlPayload(const uint8_t* aPayload, size_t aLength);
void SpeculumReplayProjectedContexts(mozilla::dom::ContentParent* aChild);

#endif
