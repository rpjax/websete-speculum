/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* Phase 7 fixtures on GeckoEngine — sole suite entry for gecko (no Phase8 A7). */

#include "gtest/gtest.h"

#include "tests/phase7/FixtureSuite.hpp"

using namespace speculum::phase7;
using namespace speculum::roteiro;

TEST(SpeculumPhase7, FixtureSuiteOnGecko) {
  // SUPPORT_FILES / w7s map fixtures next to this TU under gtest/phase7 or tests/phase7.
  const char* roots[] = {
      "tests/phase7/fixtures",
      "dom/speculum/tests/phase7/fixtures",
      "/gecko-source/dom/speculum/tests/phase7/fixtures",
  };
  std::filesystem::path fixtureRoot;
  for (auto r : roots) {
    if (std::filesystem::exists(r)) {
      fixtureRoot = r;
      break;
    }
  }
  ASSERT_FALSE(fixtureRoot.empty()) << "phase7 fixtures not found";
  EXPECT_EQ(runFixtureSuite<GeckoEngineTraits>(fixtureRoot), 0);
}
