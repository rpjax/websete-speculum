/* Speculum — sintetiza gesto no widget headless (02-costura §7). Sem pointermove. */
#include "SpeculumInput.h"

#include "mozilla/PresShell.h"
#include "mozilla/dom/Document.h"
#include "mozilla/gfx/Point.h"
#include "nsIWidget.h"
#include "widget/headless/HeadlessWidget.h"

void SpeculumSynthesizeInput(mozilla::dom::Document* aDocument,
                             const nsTArray<uint8_t>& aEvent) {
  if (!aDocument || aEvent.IsEmpty()) {
    return;
  }
  mozilla::PresShell* shell = aDocument->GetPresShell();
  nsIWidget* widget = shell ? shell->GetRootWidget() : nullptr;
  if (!widget) {
    return;
  }
  widget->SynthesizeNativeMouseMove(mozilla::LayoutDeviceIntPoint(1, 1));
}
