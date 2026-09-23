/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

#include "engines/gecko/xul/XulCssomBinder.hpp"

#if defined(SPECULUM_HAS_LIBXUL)

#include "mozilla/dom/Document.h"
#include "mozilla/dom/Element.h"
#include "nsINode.h"

namespace speculum::gecko::xul {

void XulCssomBinder::onSheetApplicable(mozilla::StyleSheet* sheet, bool applicable) {
  if (!sheet) return;
  // Owner node for <link> / constructed.
  nsINode* owner = sheet->GetOwnerNode();
  NodeRef ownerRef = owner ? nodes_.intern(static_cast<void*>(owner)) : NodeRef{};

  // Find existing or mint.
  SheetRef id{};
  for (const auto& [k, ref] : live_) {
    if (ref == sheet) {
      id = SheetRef{k};
      break;
    }
  }
  if (!id.valid()) {
    id = table_.addSheet(ownerRef, /*linked=*/true);
    live_[id.value()] = sheet;  // process-owned RefPtr
    bridge_.notifySheetAdded(id, uint32_t(table_.sheetCount() > 0 ? table_.sheetCount() - 1 : 0));
    if (ownerRef.valid()) bridge_.notifySheetOwner(id, ownerRef);
  }
  table_.setApplicable(id, applicable);
  if (applicable && ownerRef.valid()) {
    bridge_.notifySheetOwner(id, ownerRef);
  }
  // Intentionally no RuleAdded — parse-born rules are not notified (A4).
}

}  // namespace speculum::gecko::xul

#endif
