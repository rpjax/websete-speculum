#pragma once

#include <cstdint>
#include <string_view>
#include <utility>

#include "domain/ids/Ids.hpp"

namespace speculum {

struct Extent {
  int32_t width{0};
  int32_t height{0};
};

enum class NodeKind : uint8_t { Element = 1, Text = 2, Comment = 3, Document = 4 };
enum class ElementNs : uint8_t { Html = 0, Svg = 1, MathMl = 2 };
enum class ShadowMode : uint8_t { Open = 0, Closed = 1 };
enum class PromptKind : uint8_t { Dialog = 1, Permission = 2, Download = 3 };

using RequestId = uint32_t;

struct Box {
  float x{0}, y{0}, w{0}, h{0};
};

// Placeholder until interaction phase — dispatch may refuse.
struct ResolvedGesture {
  uint32_t kind{0};
};

template <class F>
struct FnVisitor {
  F fn;
  template <class... Args>
  void operator()(Args&&... a) const {
    fn(std::forward<Args>(a)...);
  }
};

}  // namespace speculum
