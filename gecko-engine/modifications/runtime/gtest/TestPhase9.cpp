/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* Phase 9 — sim × gecko wire parity (mesmo roteiro ⇒ mesmos bytes). */

#include "gtest/gtest.h"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "domain/producer/PatchBuilder.hpp"
#include "tests/phase9/WireParity.hpp"

using namespace speculum::phase9;
using namespace speculum::producer;

namespace {

std::filesystem::path findFixtures() {
  const char* roots[] = {
      "tests/phase7/fixtures",
      "dom/speculum/tests/phase7/fixtures",
      "/gecko-source/dom/speculum/tests/phase7/fixtures",
  };
  for (auto r : roots) {
    if (std::filesystem::exists(r)) return r;
  }
  return {};
}

std::filesystem::path findExclusions() {
  const char* roots[] = {
      "tests/phase9/exclusions.txt",
      "dom/speculum/tests/phase9/exclusions.txt",
      "/gecko-source/dom/speculum/tests/phase9/exclusions.txt",
  };
  for (auto r : roots) {
    if (std::filesystem::exists(r)) return r;
  }
  return {};
}

std::filesystem::path findDigestVectors() {
  const char* roots[] = {
      "tests/phase9/digest_vectors.json",
      "dom/speculum/tests/phase9/digest_vectors.json",
      "/gecko-source/dom/speculum/tests/phase9/digest_vectors.json",
  };
  for (auto r : roots) {
    if (std::filesystem::exists(r)) return r;
  }
  return {};
}

bool expectDigest(const std::string& json, const std::string& name,
                  const std::vector<uint8_t>& bytes) {
  auto key = "\"name\": \"" + name + "\"";
  auto pos = json.find(key);
  if (pos == std::string::npos) return false;
  auto dpos = json.find("\"digest\": \"", pos);
  if (dpos == std::string::npos) return false;
  dpos += 11;
  auto end = json.find('"', dpos);
  if (end == std::string::npos) return false;
  std::string want = json.substr(dpos, end - dpos);
  uint64_t got = digestBytes(bytes);
  return std::to_string(got) == want;
}

}  // namespace

TEST(SpeculumPhase9, DigestVectors) {
  auto path = findDigestVectors();
  ASSERT_FALSE(path.empty()) << "digest_vectors.json not found";
  std::ifstream in(path);
  std::string json((std::istreambuf_iterator<char>(in)),
                   std::istreambuf_iterator<char>());
  EXPECT_TRUE(expectDigest(json, "empty", {}));
  EXPECT_TRUE(expectDigest(json, "abc", {1, 2, 3}));
  EXPECT_TRUE(expectDigest(json, "pp-prefix", {0x50, 0x50, 1, 0}));
  EXPECT_EQ(std::to_string(digestTable(0, 1)), "15568218984286027500");
  EXPECT_EQ(std::to_string(digestTable(123456789ull, 42)), "1290199026284317214");
}

TEST(SpeculumPhase9, SimGeckoWireParity) {
  auto fixtures = findFixtures();
  ASSERT_FALSE(fixtures.empty()) << "phase7 fixtures not found";
  auto excl = findExclusions();
  EXPECT_EQ(runWireParity(fixtures, excl), 0);
}
