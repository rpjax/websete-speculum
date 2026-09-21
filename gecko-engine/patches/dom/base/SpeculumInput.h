/* Speculum — input nativo via widget. Hit-test real = L4. */
#ifndef DOM_BASE_SPECULUMINPUT_H_
#define DOM_BASE_SPECULUMINPUT_H_

#include "mozilla/Attributes.h"
#include "nsTArray.h"

namespace mozilla::dom {
class Document;
}

MOZ_CAN_RUN_SCRIPT_BOUNDARY void SpeculumSynthesizeInput(
    mozilla::dom::Document* aDocument, const nsTArray<uint8_t>& aEvent);

#endif
