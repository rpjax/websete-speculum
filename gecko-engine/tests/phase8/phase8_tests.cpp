// Phase 8 host binary is not an accept path (no libxul).
// Aceite: WSL + w7s → mach gtest SpeculumPhase7.* + SpeculumPhase8.*
#include <cstdio>
int main() {
  std::printf(
      "phase8 host stub — accept is mach gtest SpeculumPhase7.* SpeculumPhase8.*\n");
  return 0;
}
