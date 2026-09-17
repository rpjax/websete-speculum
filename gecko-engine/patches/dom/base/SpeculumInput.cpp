/* Speculum — decodifica o gesto e aplica no widget. Sem pixel inventado. */
#include "SpeculumInput.h"

#include "SpeculumLog.h"
#include "SpeculumMutationObserver.h"
#include "SpeculumTelemetry.h"
#include "mozilla/EventForwards.h"
#include "mozilla/FlushType.h"
#include "mozilla/MouseEvents.h"
#include "mozilla/PresShell.h"
#include "mozilla/TextEvents.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/DOMRect.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/Element.h"
#include "mozilla/dom/MouseEventBinding.h"
#include "nsContentUtils.h"
#include <algorithm>
#include "nsFocusManager.h"
#include "nsIWidget.h"
#include "nsLayoutUtils.h"
#include "nsPresContext.h"
#include "nsIFrame.h"
#include "Units.h"
#include "nsPIDOMWindow.h"
#include "nsString.h"
#include "speculum/InputHit.h"

#include <cstdint>

using mozilla::PresShell;
using mozilla::WidgetKeyboardEvent;
using mozilla::WidgetMouseEvent;
using mozilla::dom::Document;
using mozilla::dom::Element;

namespace {

uint32_t ReadU32(const uint8_t* p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) |
         (uint32_t(p[3]) << 24);
}

uint16_t ReadU16(const uint8_t* p) {
  return uint16_t(p[0]) | (uint16_t(p[1]) << 8);
}

bool ReadStr(const uint8_t* data, size_t len, size_t& pos, nsCString& out) {
  if (pos + 4 > len) {
    return false;
  }
  const uint32_t n = ReadU32(data + pos);
  pos += 4;
  if (pos + n > len) {
    return false;
  }
  out.Assign(reinterpret_cast<const char*>(data + pos), n);
  pos += n;
  return true;
}

uint32_t ContextOf(Document* aDocument) {
  if (!aDocument) {
    return 0;
  }
  if (mozilla::dom::BrowsingContext* bc = aDocument->GetBrowsingContext()) {
    return bc->GetSpeculumContextId();
  }
  return 0;
}

Element* ElementFromNode(nsINode* aNode, Document* aDocument) {
  if (!aNode) {
    return nullptr;
  }
  if (aNode->IsElement()) {
    return aNode->AsElement();
  }
  if (aNode->IsDocument() && aDocument) {
    return aDocument->GetDocumentElement();
  }
  return nullptr;
}

nsIWidget* RootWidget(Document* aDocument) {
  PresShell* pres = aDocument ? aDocument->GetPresShell() : nullptr;
  return pres ? pres->GetRootWidget() : nullptr;
}

void DispatchMouse(Document* aDocument, Element* aElement, bool aDown,
                   uint16_t aLocalX, uint16_t aLocalY, uint8_t aButton) {
  aDocument->FlushPendingNotifications(mozilla::FlushType::Layout);
  PresShell* pres = aDocument->GetPresShell();
  nsIWidget* widget = RootWidget(aDocument);
  nsPresContext* pc = pres ? pres->GetPresContext() : nullptr;
  if (!pres || !widget || !pc) {
    return;
  }

  if (nsFocusManager* fm = nsFocusManager::GetFocusManager()) {
    fm->SetFocus(aElement, 0);
  }

  // nodeId + local% on the named element. Hit-testing from the root frame
  // misses under overlay/scale/scroll — same class Chromium banned.
  nsIFrame* frame = aElement->GetPrimaryFrame();
  nsPoint appOffset;
  nsIWidget* nearest = nullptr;
  mozilla::LayoutDeviceIntPoint ref;
  const int32_t au = pc->AppUnitsPerDevPixel();
  if (frame) {
    nearest = frame->GetNearestWidget(appOffset);
    const float fx = float(aLocalX) / 65535.f;
    const float fy = float(aLocalY) / 65535.f;
    const nsSize size = frame->GetSize();
    const nsPoint local(NSToCoordRound(size.width * fx),
                        NSToCoordRound(size.height * fy));
    ref = mozilla::LayoutDeviceIntPoint::FromAppUnitsToNearest(appOffset + local,
                                                               au);
  } else {
    nsIFrame* root = pres->GetRootFrame();
    if (!root) {
      return;
    }
    nearest = root->GetNearestWidget(appOffset);
    RefPtr<mozilla::dom::DOMRect> rect = aElement->GetBoundingClientRect();
    speculum::Box box{static_cast<float>(rect->X()),
                      static_cast<float>(rect->Y()),
                      static_cast<float>(rect->Width()),
                      static_cast<float>(rect->Height())};
    speculum::Point hit = speculum::HitInBox(box, aLocalX, aLocalY);
    ref = mozilla::LayoutDeviceIntPoint::FromAppUnitsToNearest(appOffset, au);
    const mozilla::CSSToLayoutDeviceScale scale = pc->CSSToDevPixelScale();
    ref.x += NSToIntRound(hit.x * scale.scale);
    ref.y += NSToIntRound(hit.y * scale.scale);
  }
  if (!nearest) {
    nearest = widget;
  }

  WidgetMouseEvent event(true, aDown ? eMouseDown : eMouseUp, nearest,
                         WidgetMouseEvent::eReal);
  event.mRefPoint = ref;
  event.mButton = aButton == 1   ? mozilla::MouseButton::eMiddle
                  : aButton == 2 ? mozilla::MouseButton::eSecondary
                                 : mozilla::MouseButton::ePrimary;
  event.mClickCount = 1;
  event.mInputSource = mozilla::dom::MouseEvent_Binding::MOZ_SOURCE_MOUSE;
  nsEventStatus status = nsEventStatus_eIgnore;
  pres->HandleEventWithTarget(&event, frame, aElement, &status);
}

void FillKeyEvent(WidgetKeyboardEvent& aEvent, const nsCString& aKey,
                  const nsCString& aCode, uint8_t aMods) {
  aEvent.mKeyNameIndex = KEY_NAME_INDEX_USE_STRING;
  aEvent.mCodeNameIndex = CODE_NAME_INDEX_USE_STRING;
  CopyUTF8toUTF16(aKey, aEvent.mKeyValue);
  CopyUTF8toUTF16(aCode, aEvent.mCodeValue);
  if (aMods & 1) {
    aEvent.mModifiers |= mozilla::MODIFIER_CONTROL;
  }
  if (aMods & 2) {
    aEvent.mModifiers |= mozilla::MODIFIER_SHIFT;
  }
  if (aMods & 4) {
    aEvent.mModifiers |= mozilla::MODIFIER_ALT;
  }
  if (aMods & 8) {
    aEvent.mModifiers |= mozilla::MODIFIER_META;
  }
}

void DispatchKey(Document* aDocument, bool aDown, const nsCString& aKey,
                 const nsCString& aCode, uint8_t aMods) {
  aDocument->FlushPendingNotifications(mozilla::FlushType::Layout);
  RefPtr<PresShell> pres = aDocument->GetPresShell();
  nsIWidget* widget = RootWidget(aDocument);
  Element* target = nullptr;
  if (Element* focused = nsFocusManager::GetFocusedElementStatic()) {
    if (focused->OwnerDoc() == aDocument && focused->IsInComposedDoc()) {
      target = focused;
    }
  }
  if (!target) {
    target = aDocument->GetDocumentElement();
  }
  if (!pres || !widget || !target || !target->IsInComposedDoc()) {
    SPECULUM_LOG("[SPECULUM-INPUT] tecla sem presshell/widget/root");
    return;
  }

  auto fire = [&](mozilla::EventMessage msg) {
    WidgetKeyboardEvent event(true, msg, widget);
    FillKeyEvent(event, aKey, aCode, aMods);
    (void)widget->AttachNativeKeyEvent(event);
    nsEventStatus status = nsEventStatus_eIgnore;
    pres->HandleEventWithTarget(&event, target->GetPrimaryFrame(), target,
                                &status);
  };
  // HandleEvent() retargets keys to chrome. Deliver to the focused node in
  // this document (search/input), not <html>.
  fire(aDown ? eKeyDown : eKeyUp);
  if (aDown && (aKey.Length() == 1 || aKey.EqualsLiteral("Enter"))) {
    fire(eKeyPress);
  }
}

void ApplyScroll(Document* aDocument, uint32_t aNodeId, uint16_t aFracX,
                 uint16_t aFracY) {
  const double fx = double(aFracX) / 65535.0;
  const double fy = double(aFracY) / 65535.0;
  if (aNodeId == 0) {
    Element* root = aDocument->GetScrollingElement();
    if (!root) {
      root = aDocument->GetDocumentElement();
    }
    if (!root) {
      return;
    }
    const double maxX =
        std::max(0.0, double(root->ScrollWidth()) - root->ClientWidth());
    const double maxY =
        std::max(0.0, double(root->ScrollHeight()) - root->ClientHeight());
    root->SetScrollLeft(int32_t(fx * maxX));
    root->SetScrollTop(int32_t(fy * maxY));
    return;
  }

  const uint32_t ctx = ContextOf(aDocument);
  nsINode* node = SpeculumNodeForId(ctx, aNodeId);
  Element* el = ElementFromNode(node, aDocument);
  if (!el) {
    return;
  }
  const double maxX =
      std::max(0.0, double(el->ScrollWidth()) - el->ClientWidth());
  const double maxY =
      std::max(0.0, double(el->ScrollHeight()) - el->ClientHeight());
  el->SetScrollLeft(int32_t(fx * maxX));
  el->SetScrollTop(int32_t(fy * maxY));
}

}  // namespace

void SpeculumSynthesizeInput(Document* aDocument,
                             const nsTArray<uint8_t>& aEvent) {
  if (!aDocument || aEvent.IsEmpty()) {
    SPECULUM_LOG("[SPECULUM-INPUT] sem documento ou envelope vazio");
    return;
  }

  const uint8_t* data = aEvent.Elements();
  const size_t len = aEvent.Length();
  const uint8_t type = data[0];
  if (type < 1 || type > 5) {
    SPECULUM_LOG("[SPECULUM-INPUT] tipo=%u ignorado", type);
    return;
  }

  const uint32_t ctx = ContextOf(aDocument);
  if (!ctx) {
    return;
  }

  if (type == 1 || type == 2) {
    if (len < 1 + 4 + 2 + 2 + 1) {
      SpeculumEmitInput(ctx, type, false);
      return;
    }
    const uint32_t nodeId = ReadU32(data + 1);
    if (nodeId == 0) {
      SpeculumEmitInput(ctx, type, false);
      return;
    }
    nsINode* node = SpeculumNodeForId(ctx, nodeId);
    Element* el = ElementFromNode(node, aDocument);
    if (!el) {
      SpeculumEmitInput(ctx, type, false);
      return;
    }
    DispatchMouse(aDocument, el, type == 1, ReadU16(data + 5),
                  ReadU16(data + 7), data[9]);
    SpeculumEmitInput(ctx, type, true);
    return;
  }

  if (type == 3 || type == 4) {
    size_t pos = 1;
    nsCString key;
    nsCString code;
    if (!ReadStr(data, len, pos, key) || !ReadStr(data, len, pos, code) ||
        pos >= len) {
      SpeculumEmitInput(ctx, type, false);
      return;
    }
    DispatchKey(aDocument, type == 3, key, code, data[pos]);
    SpeculumEmitInput(ctx, type, true);
    return;
  }

  if (type == 5) {
    if (len < 1 + 4 + 2 + 2) {
      SpeculumEmitInput(ctx, type, false);
      return;
    }
    ApplyScroll(aDocument, ReadU32(data + 1), ReadU16(data + 5),
                ReadU16(data + 7));
    SpeculumEmitInput(ctx, type, true);
  }
}
