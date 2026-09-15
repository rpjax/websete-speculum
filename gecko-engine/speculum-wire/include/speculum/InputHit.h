// Caixa viva → ponto. Fração 0…65535 = [0, 1]. Sem pixel inventado.
#pragma once

#include <cstdint>

namespace speculum {

struct Box {
  float x;
  float y;
  float w;
  float h;
};

struct Point {
  float x;
  float y;
};

inline Point HitInBox(const Box& box, uint16_t localX, uint16_t localY) {
  const float scale = 65535.f;
  return {box.x + (static_cast<float>(localX) / scale) * box.w,
          box.y + (static_cast<float>(localY) / scale) * box.h};
}

inline uint16_t FracToU16(float frac) {
  if (frac <= 0.f) {
    return 0;
  }
  if (frac >= 1.f) {
    return 65535;
  }
  return static_cast<uint16_t>(frac * 65535.f + 0.5f);
}

}  // namespace speculum
