// Phase 7 — host entry (Sim). Body: FixtureSuite.hpp
#include "tests/phase7/FixtureSuite.hpp"

int main() {
  using namespace speculum::phase7;
  using namespace speculum::roteiro;
  return runFixtureSuite<SimEngineTraits>("tests/phase7/fixtures") == 0 ? 0 : 1;
}
