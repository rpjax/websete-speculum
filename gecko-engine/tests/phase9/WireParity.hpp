#pragma once

// Phase 9 — oráculo sim × gecko: mesmo roteiro ⇒ mesmos bytes de patch.
// Textual exclusions: tests/phase9/exclusions.txt (path + reason). Silent skip = fail.

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "domain/oracle/Capabilities.hpp"
#include "domain/producer/PatchBuilder.hpp"
#include "domain/roteiro/Parse.hpp"
#include "domain/roteiro/SpecDriver.hpp"
#include "tests/phase7/EngineTraits.hpp"
#include "tests/phase7/FixtureSuite.hpp"

namespace speculum::phase9 {

namespace fs = std::filesystem;
using namespace speculum::oracle;
using namespace speculum::roteiro;
using namespace speculum::phase7;

struct ParityReport {
  int fails{0};
  int compared{0};
  int excluded{0};
  void check(bool c, const char* m) {
    if (!c) {
      std::fprintf(stderr, "FAIL phase9: %s\n", m);
      ++fails;
    }
  }
};

inline void stripBom(std::string& text) {
  if (text.size() >= 3 && (unsigned char)text[0] == 0xEF &&
      (unsigned char)text[1] == 0xBB && (unsigned char)text[2] == 0xBF) {
    text.erase(0, 3);
  }
}

inline std::string readFile(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  return std::string((std::istreambuf_iterator<char>(in)),
                     std::istreambuf_iterator<char>());
}

// path relative to fixtures root → reason (must be non-empty).
// parseErrors: malformed / empty-reason lines (README: must fail the harness).
struct ExclusionLoad {
  std::unordered_map<std::string, std::string> map;
  int parseErrors{0};
};

inline ExclusionLoad loadExclusions(const fs::path& exclusionsFile) {
  ExclusionLoad out;
  if (!fs::exists(exclusionsFile)) return out;
  std::ifstream in(exclusionsFile);
  std::string line;
  while (std::getline(in, line)) {
    if (line.empty() || line[0] == '#') continue;
    auto tab = line.find('\t');
    if (tab == std::string::npos) {
      std::fprintf(stderr, "FAIL phase9 exclusions: need PATH\\tREASON: %s\n",
                   line.c_str());
      ++out.parseErrors;
      continue;
    }
    std::string path = line.substr(0, tab);
    std::string reason = line.substr(tab + 1);
    while (!reason.empty() && (reason.back() == '\r' || reason.back() == ' '))
      reason.pop_back();
    if (reason.empty()) {
      std::fprintf(stderr, "FAIL phase9 exclusions: empty reason for %s\n",
                   path.c_str());
      ++out.parseErrors;
      continue;
    }
    out.map[path] = reason;
  }
  return out;
}

inline std::string firstDiff(const std::vector<std::vector<uint8_t>>& a,
                             const std::vector<std::vector<uint8_t>>& b) {
  std::ostringstream oss;
  if (a.size() != b.size()) {
    oss << "patch count sim=" << a.size() << " gecko=" << b.size();
    return oss.str();
  }
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i].size() != b[i].size()) {
      oss << "patch[" << i << "] len sim=" << a[i].size()
          << " gecko=" << b[i].size();
      return oss.str();
    }
    for (size_t o = 0; o < a[i].size(); ++o) {
      if (a[i][o] != b[i][o]) {
        oss << "patch[" << i << "] offset " << o << " sim=0x" << std::hex
            << int(a[i][o]) << " gecko=0x" << int(b[i][o]);
        return oss.str();
      }
    }
  }
  return {};
}

inline bool patchesEqual(const std::vector<std::vector<uint8_t>>& a,
                         const std::vector<std::vector<uint8_t>>& b) {
  return firstDiff(a, b).empty();
}

// Replay one .spec on both engines; compare uplink patch bytes.
inline bool compareSpecFile(const fs::path& specPath, const std::string& schema,
                            std::string* detail,
                            std::vector<std::vector<uint8_t>>* outSimPatches = nullptr) {
  auto text = readFile(specPath);
  stripBom(text);
  auto parsed = parseSpec(text);
  if (!parsed.ok) {
    if (detail) *detail = "parse: " + parsed.error.message;
    return false;
  }
  parsed.file.schemaHash = schema;

  Capabilities caps;
  caps.applyPresetLab();

  SpecDriverT<SimEngineTraits> sim(schema);
  sim.enablePostcondition(true);
  // Phase 7 = fidelity per engine (oracle there). Phase 9 = byte agreement across
  // engines — and each side must still pass the oracle so two equal wrongs fail.
  auto rs = sim.replay(parsed.file, caps, /*runOracle=*/true);
  if (!rs.ok) {
    if (detail) *detail = "sim: " + rs.message;
    return false;
  }

  SpecDriverT<GeckoEngineTraits> gecko(schema);
  gecko.enablePostcondition(true);
  auto rg = gecko.replay(parsed.file, caps, /*runOracle=*/true);
  if (!rg.ok) {
    if (detail) *detail = "gecko: " + rg.message;
    return false;
  }

  auto diff = firstDiff(rs.patches, rg.patches);
  if (!diff.empty()) {
    if (detail) *detail = diff;
    return false;
  }
  if (rs.tableHash != rg.tableHash) {
    if (detail) {
      *detail = "tableHash diverge sim=" + std::to_string(rs.tableHash) +
                " gecko=" + std::to_string(rg.tableHash);
    }
    return false;
  }
  if (outSimPatches) *outSimPatches = rs.patches;
  return true;
}

inline const char* kRequiredSpecs[] = {
    "correcao/attr-text.spec",
    "estrutural/list-tail-remove.spec",
    "cssom/link-applicable-no-rule.spec",
    "aninhamento/host-born-die-same-interval.spec",
    "aninhamento/nested-shadow.spec",
    "ciclo/nav-under-load-pending-dirt.spec",
    "estresse/batch-insert.spec",
    "adversaria/prepend-stress.spec",
    "adversaria/insert-before-remove.spec",
    "adversaria/link-applicable-no-rule.spec",
    "adversaria/host-born-die-same-interval.spec",
    "adversaria/nav-under-load-pending-dirt.spec",
    "adversaria/nested-shadow.spec",
};

// Returns fail count. exclusionsPath may be empty → no exclusions allowed.
// excluded > 0 requires SPECULUM_PHASE9_ALLOW_EXCLUSIONS=1 (never normal).
inline int runWireParity(const fs::path& fixtureRoot, const fs::path& exclusionsPath,
                         const std::string& schema = defaultSchemaHash()) {
  ParityReport rep;
  auto loaded = loadExclusions(exclusionsPath);
  rep.fails += loaded.parseErrors;
  auto excl = std::move(loaded.map);

  for (auto rel : kRequiredSpecs) {
    auto it = excl.find(rel);
    if (it != excl.end()) {
      std::printf("SKIP phase9 %s — %s\n", rel, it->second.c_str());
      ++rep.excluded;
      excl.erase(it);
      continue;
    }
    auto p = fixtureRoot / rel;
    if (!fs::exists(p)) {
      rep.check(false, rel);
      std::fprintf(stderr, "missing fixture %s\n", rel);
      continue;
    }
    std::string detail;
    std::vector<std::vector<uint8_t>> simPatches;
    bool ok = compareSpecFile(p, schema, &detail, &simPatches);
    ++rep.compared;
    if (!ok) {
      std::fprintf(stderr, "parity %s: %s\n", rel, detail.c_str());
      rep.check(false, rel);
    } else {
      std::printf("PASS phase9 %s\n", rel);
      // Digest dump when gate sets SPECULUM_PHASE9_DIGEST_OUT (ci:all does).
      if (const char* outDir = std::getenv("SPECULUM_PHASE9_DIGEST_OUT")) {
        fs::path dir(outDir);
        fs::create_directories(dir);
        for (size_t i = 0; i < simPatches.size(); ++i) {
          auto stem = fs::path(rel).filename().string() + "." + std::to_string(i);
          auto bin = dir / (stem + ".bin");
          auto dig = dir / (stem + ".digest.txt");
          std::ofstream(bin, std::ios::binary)
              .write(reinterpret_cast<const char*>(simPatches[i].data()),
                     static_cast<std::streamsize>(simPatches[i].size()));
          std::ofstream(dig) << producer::digestBytes(simPatches[i]);
        }
      }
    }
  }

  for (const auto& [path, reason] : excl) {
    std::fprintf(stderr, "FAIL phase9 stale exclusion %s (%s)\n", path.c_str(),
                 reason.c_str());
    ++rep.fails;
  }

  if (rep.compared == 0) {
    std::fprintf(stderr, "FAIL phase9: compared == 0 (gate did no work)\n");
    ++rep.fails;
  }

  if (rep.excluded > 0) {
    const char* allow = std::getenv("SPECULUM_PHASE9_ALLOW_EXCLUSIONS");
    if (!allow || std::string(allow) != "1") {
      std::fprintf(stderr,
                   "FAIL phase9: excluded=%d without SPECULUM_PHASE9_ALLOW_EXCLUSIONS=1\n",
                   rep.excluded);
      ++rep.fails;
    }
  }

  if (rep.fails) {
    std::fprintf(stderr, "phase9 FAIL (%d fails, %d compared, %d excluded)\n",
                 rep.fails, rep.compared, rep.excluded);
  } else {
    std::printf("phase9 PASS (%d compared, %d excluded)\n", rep.compared,
                rep.excluded);
  }
  return rep.fails;
}

}  // namespace speculum::phase9
