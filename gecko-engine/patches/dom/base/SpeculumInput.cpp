/* Speculum — apply nativo no HeadlessWidget ainda não há (02-costura §7). */
#include "SpeculumInput.h"

void SpeculumSynthesizeInput(mozilla::dom::Document* aDocument,
                             const nsTArray<uint8_t>& aEvent) {
  // Sem decoder da intenção e sem gesto inventado. Envelope chega; efeito = 0.
  (void)aDocument;
  (void)aEvent;
}
