/* Speculum — diálogo pede e espera. Silêncio ≠ ok. Sem auto-ok. */
#ifndef DOM_IPC_SPECULUMMARIONETTE_H_
#define DOM_IPC_SPECULUMMARIONETTE_H_

#include "nsString.h"

bool SpeculumWaitDialogRespond(uint32_t aContextId, uint32_t aRequestId,
                               const nsACString& aDescription,
                               nsACString& aAnswer);
void SpeculumCompleteDialog(uint32_t aContextId, uint32_t aRequestId,
                            const nsACString& aAnswer);

#endif
