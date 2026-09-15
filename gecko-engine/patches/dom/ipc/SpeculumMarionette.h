/* Speculum — diálogo pede e espera. Silêncio ≠ ok. Sem auto-ok. */
#ifndef DOM_IPC_SPECULUMMARIONETTE_H_
#define DOM_IPC_SPECULUMMARIONETTE_H_

#include "nsString.h"

#include <cstdint>

enum class SpeculumAskKind : uint8_t { Dialog = 0, Permission = 1, Download = 2 };

bool SpeculumWaitDialogRespond(uint32_t aContextId, uint32_t aRequestId,
                               const nsACString& aDescription,
                               nsACString& aAnswer);
void SpeculumCompleteDialog(uint32_t aContextId, uint32_t aRequestId,
                            const nsACString& aAnswer);

uint32_t SpeculumNextRequestId();
bool SpeculumAskAndWait(uint32_t aContextId, SpeculumAskKind aKind,
                        const nsACString& aDescription, nsACString& aAnswer);

#endif
