// L0 — caixa falsa: 32768,32768 é o centro. Sem widget.
#include "speculum/InputHit.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>

static int gFail = 0;

static void Expect(const char* name, float got, float want) {
  if (std::fabs(got - want) > 0.01f) {
    std::fprintf(stderr, "FALHOU %s: got=%f want=%f\n", name, got, want);
    gFail = 1;
    return;
  }
  std::printf("  ok   %s\n", name);
}

int main() {
  speculum::Box box{0.f, 0.f, 100.f, 50.f};
  speculum::Point c = speculum::HitInBox(box, 32768, 32768);
  Expect("centro.x", c.x, 50.f);
  Expect("centro.y", c.y, 25.f);

  speculum::Point tl = speculum::HitInBox(box, 0, 0);
  Expect("origem.x", tl.x, 0.f);
  Expect("origem.y", tl.y, 0.f);

  speculum::Point br = speculum::HitInBox(box, 65535, 65535);
  Expect("canto.x", br.x, 100.f);
  Expect("canto.y", br.y, 50.f);

  speculum::Box shifted{10.f, 20.f, 40.f, 10.f};
  speculum::Point mid = speculum::HitInBox(shifted, 32768, 32768);
  Expect("deslocado.x", mid.x, 30.f);
  Expect("deslocado.y", mid.y, 25.f);

  if (speculum::FracToU16(0.5f) != 32768 && speculum::FracToU16(0.5f) != 32767) {
    std::fprintf(stderr, "FALHOU FracToU16(0.5)\n");
    return 1;
  }
  std::printf("  ok   FracToU16\n");
  return gFail;
}
