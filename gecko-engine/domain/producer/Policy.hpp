#pragma once

#include "domain/Types.hpp"

namespace speculum::producer {

enum class Plane : uint8_t { None = 0, Dom = 1, Cssom = 2 };

struct Policy {
  // Nothing browser-created is projectable.
  static bool isProjectable(NodeKind kind, bool userAgentOwned) {
    if (userAgentOwned) return false;
    switch (kind) {
      case NodeKind::Element:
      case NodeKind::Text:
      case NodeKind::Comment:
      case NodeKind::Document:
        return true;
      default:
        return true;
    }
  }

  // Author <style> paints via projected DOM — not CSSOM plane.
  // <link> and constructed/adopted stay on CSSOM plane.
  static Plane planeOfSheet(bool authorStyleOwner, bool constructed, bool linked) {
    if (constructed || linked) return Plane::Cssom;
    if (authorStyleOwner) return Plane::Dom;
    return Plane::Cssom;
  }

  static bool isFrameHost(NodeKind kind, bool hasChildFrame) {
    return kind == NodeKind::Element && hasChildFrame;
  }
};

}  // namespace speculum::producer
