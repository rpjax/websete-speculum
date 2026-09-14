/* Speculum — input nativo via widget (02-costura §7). Hit-test real = L4. */
#ifndef DOM_BASE_SPECULUMINPUT_H_
#define DOM_BASE_SPECULUMINPUT_H_

#include "nsTArray.h"

namespace mozilla::dom {
class Document;
}

void SpeculumSynthesizeInput(mozilla::dom::Document* aDocument,
                             const nsTArray<uint8_t>& aEvent);

#endif
