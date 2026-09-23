#pragma once

#if defined(SPECULUM_HAS_LIBXUL)

#include "mozilla/RefPtr.h"
#include "mozilla/StyleSheet.h"

#include <unordered_map>

#include "engines/gecko/CssomTable.hpp"
#include "engines/gecko/MutationBridge.hpp"
#include "engines/gecko/RawNodeMap.hpp"

namespace mozilla::dom {
class Document;
}

namespace speculum::gecko::xul {

// Strong StyleSheet refs live on the process CssomTable side — never on Document.
class XulCssomBinder {
 public:
  XulCssomBinder(CssomTable& table, RawNodeMap& nodes, MutationBridge& bridge)
      : table_(table), nodes_(nodes), bridge_(bridge) {}

  // Linked sheet completed / applicable — no RuleAdded from parse (ITERACAO-06 A4).
  void onSheetApplicable(mozilla::StyleSheet* sheet, bool applicable);

  void clear() {
    live_.clear();
    table_.clear();
  }

 private:
  CssomTable& table_;
  RawNodeMap& nodes_;
  MutationBridge& bridge_;
  std::unordered_map<uint32_t, RefPtr<mozilla::StyleSheet>> live_;
};

}  // namespace speculum::gecko::xul

#endif
