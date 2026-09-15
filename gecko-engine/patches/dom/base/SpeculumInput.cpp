/* Speculum — decodifica o gesto e aplica no widget. Sem pixel inventado. */
#include "SpeculumInput.h"

#include "SpeculumLog.h"
#include "SpeculumMutationObserver.h"
#include "mozilla/EventForwards.h"
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
  PresShell* pres = aDocument->GetPresShell();
  nsIWidget* widget = RootWidget(aDocument);
  if (!pres || !widget) {
    return;
  }

  RefPtr<mozilla::dom::DOMRect> rect = aElement->GetBoundingClientRect();
  speculum::Box box{static_cast<float>(rect->X()),
                    static_cast<float>(rect->Y()),
                    static_cast<float>(rect->Width()),
                    static_cast<float>(rect->Height())};
  speculum::Point hit = speculum::HitInBox(box, aLocalX, aLocalY);

  if (nsFocusManager* fm = nsFocusManager::GetFocusManager()) {
    fm->SetFocus(aElement, 0);
  }

  WidgetMouseEvent event(true, aDown ? eMouseDown : eMouseUp, widget,
                         WidgetMouseEvent::eReal);
  event.mRefPoint = mozilla::LayoutDeviceIntPoint(int32_t(hit.x),
                                                  int32_t(hit.y));
  event.mButton = aButton == 1   ? mozilla::MouseButton::eMiddle
                  : aButton == 2 ? mozilla::MouseButton::eSecondary
                                 : mozilla::MouseButton::ePrimary;
  event.mClickCount = 1;
  event.mInputSource = mozilla::dom::MouseEvent_Binding::MOZ_SOURCE_MOUSE;
  mozilla::EventStatus status = mozilla::eEventStatus_eIgnore;
  pres->HandleEvent(pres->GetRootFrame(), event, false, &status);
}

void DispatchKey(Document* aDocument, bool aDown, const nsCString& aKey,
                 const nsCString& aCode, uint8_t aMods) {
  nsIWidget* widget = RootWidget(aDocument);
  PresShell* pres = aDocument->GetPresShell();
  if (!widget || !pres) {
    return;
  }

  WidgetKeyboardEvent event(true, aDown ? eKeyDown : eKeyUp, widget);
  event.mKeyNameIndex = KEY_NAME_INDEX_USE_STRING;
  event.mCodeNameIndex = CODE_NAME_INDEX_USE_STRING;
  CopyUTF8toUTF16(aKey, event.mKeyValue);
  CopyUTF8toUTF16(aCode, event.mCodeValue);
  if (aMods & 1) {
    event.mModifiers |= mozilla::MODIFIER_CONTROL;
  }
  if (aMods & 2) {
    event.mModifiers |= mozilla::MODIFIER_SHIFT;
  }
  if (aMods & 4) {
    event.mModifiers |= mozilla::MODIFIER_ALT;
  }
  if (aMods & 8) {
    event.mModifiers |= mozilla::MODIFIER_META;
  }
  mozilla::EventStatus status = mozilla::eEventStatus_eIgnore;
  pres->HandleEvent(pres->GetRootFrame(), event, false, &status);
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
      return;
    }
    const uint32_t nodeId = ReadU32(data + 1);
    if (nodeId == 0) {
      return;
    }
    nsINode* node = SpeculumNodeForId(ctx, nodeId);
    Element* el = ElementFromNode(node, aDocument);
    if (!el) {
      return;
    }
    DispatchMouse(aDocument, el, type == 1, ReadU16(data + 5),
                  ReadU16(data + 7), data[9]);
    return;
  }

  if (type == 3 || type == 4) {
    size_t pos = 1;
    nsCString key;
    nsCString code;
    if (!ReadStr(data, len, pos, key) || !ReadStr(data, len, pos, code) ||
        pos >= len) {
      return;
    }
    DispatchKey(aDocument, type == 3, key, code, data[pos]);
    return;
  }

  if (type == 5) {
    if (len < 1 + 4 + 2 + 2) {
      return;
    }
    ApplyScroll(aDocument, ReadU32(data + 1), ReadU16(data + 5),
                ReadU16(data + 7));
  }
}
