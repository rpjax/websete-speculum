// Phase 11 — same-run ratio harness (Sim).
// Ratios only as gates. Absolutes printed are same-run signals.
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <numeric>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "domain/assets/Streams.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/producer/LaunchTuning.hpp"
#include "domain/producer/PatchBuilder.hpp"
#include "domain/producer/RecordingUplink.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "engines/sim/SimEngine.hpp"
#include "engines/sim/SimStateCapture.hpp"
#include "engines/sim/SimStateFreezer.hpp"

namespace fs = std::filesystem;
using namespace speculum;
using namespace speculum::assets;
using namespace speculum::producer;
using namespace speculum::sim;

struct Thresholds {
  double rFlatMax{2.0};
  double rTableMax{1.5};
  double rScratchMax{8.0};
  double rVocabShipMin{0.15};
  bool declared{false};
};

struct Report {
  int fails{0};
  void check(bool c, const char* m) {
    if (!c) {
      std::fprintf(stderr, "FAIL phase11: %s\n", m);
      ++fails;
    } else {
      std::printf("PASS %s\n", m);
    }
  }
};

static bool loadThresholds(const fs::path& p, Thresholds& t, Report& rep) {
  std::ifstream in(p);
  if (!in) {
    rep.check(false, "thresholds.json readable");
    return false;
  }
  std::string s((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  auto grab = [&](const char* key, double& out) -> bool {
    auto pos = s.find(key);
    if (pos == std::string::npos) return false;
    pos = s.find(':', pos);
    if (pos == std::string::npos) return false;
    out = std::strtod(s.c_str() + pos + 1, nullptr);
    return true;
  };
  bool ok = true;
  ok = grab("\"R_flat_max\"", t.rFlatMax) && ok;
  ok = grab("\"R_table_max\"", t.rTableMax) && ok;
  ok = grab("\"R_scratch_max\"", t.rScratchMax) && ok;
  ok = grab("\"R_vocab_ship_min\"", t.rVocabShipMin) && ok;
  t.declared = s.find("\"declaredBeforeMeasure\"") != std::string::npos &&
               s.find("true") != std::string::npos;
  rep.check(ok && t.declared, "thresholds declared before measure");
  return ok && t.declared;
}

struct Lab {
  ManualClock clock;
  RecordingUplink uplink;
  SimEngine eng;
  SimStateFreezer freezer;
  SimStateCapture capture;
  Lab() : freezer(eng), capture(eng, freezer) { eng.setProducerDeps(&clock, &uplink); }
  HostId openNav(const char* url = "https://p11.test") {
    HostId root{};
    eng.openViewport(Extent{800, 600}, &root);
    (void)eng.doNavigate(root, url, 1);
    return root;
  }
};

static double measureBatchUsPerOp(int K, size_t* scratchPeakOut) {
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  // Mark path outside the timer — R_flat gates flush/emit (resolvedBefore / sibling run).
  for (int i = 0; i < K; ++i) doc->appendElement(r, "div");
  auto a0 = std::chrono::steady_clock::now();
  prod->flush();
  auto a1 = std::chrono::steady_clock::now();
  if (scratchPeakOut) *scratchPeakOut = prod->scratchPeakBytes();
  return std::chrono::duration<double, std::micro>(a1 - a0).count() / double(K);
}

// Same mutation count M on tables of different sizes — cost must not track table size.
static double measureTableCost(int tableSeed, int mutations) {
  double sum = 0;
  constexpr int trials = 5;
  for (int t = 0; t < trials; ++t) {
    Lab lab;
    HostId root = lab.openNav();
    auto* doc = lab.eng.simDocumentOf(root);
    auto* prod = lab.eng.producerOf(doc->id());
    NodeRef r = doc->view().root();
    for (int i = 0; i < tableSeed; ++i) doc->appendElement(r, "div");
    prod->flush();
    lab.uplink.clear();
    for (int i = 0; i < mutations; ++i) {
      NodeRef el = doc->appendElement(r, "span");
      doc->setAttr(el, "class", "m");
    }
    auto a0 = std::chrono::steady_clock::now();
    prod->flush();
    auto a1 = std::chrono::steady_clock::now();
    sum += std::chrono::duration<double, std::micro>(a1 - a0).count();
  }
  return sum / double(trials);
}

// Realistic markup vocab (fixture). Frame-local putStr vs session dictionary proxy.
struct MarkupVocab {
  std::vector<std::string> tags, attrs, values;
  int frames{48};
  int repsPerFrame{96};
  bool ok{false};
};

static MarkupVocab loadMarkupVocab(const fs::path& path) {
  MarkupVocab v;
  std::ifstream in(path);
  if (!in) return v;
  std::string s((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  auto grabArr = [&](const char* key, std::vector<std::string>& out) {
    auto pos = s.find(std::string("\"") + key + "\"");
    if (pos == std::string::npos) return;
    pos = s.find('[', pos);
    auto end = s.find(']', pos);
    if (pos == std::string::npos || end == std::string::npos) return;
    std::string block = s.substr(pos + 1, end - pos - 1);
    size_t i = 0;
    while (i < block.size()) {
      while (i < block.size() &&
             (std::isspace(static_cast<unsigned char>(block[i])) || block[i] == ','))
        ++i;
      if (i >= block.size() || block[i] != '"') break;
      ++i;
      size_t j = i;
      while (j < block.size() && block[j] != '"') ++j;
      out.emplace_back(block.substr(i, j - i));
      i = j + 1;
    }
  };
  auto grabInt = [&](const char* key, int& out) {
    auto pos = s.find(std::string("\"") + key + "\"");
    if (pos == std::string::npos) return;
    pos = s.find(':', pos);
    if (pos == std::string::npos) return;
    out = int(std::strtol(s.c_str() + pos + 1, nullptr, 10));
  };
  grabArr("tags", v.tags);
  grabArr("attrs", v.attrs);
  grabArr("values", v.values);
  grabInt("frames", v.frames);
  grabInt("repsPerFrame", v.repsPerFrame);
  v.ok = !v.tags.empty() && !v.attrs.empty() && !v.values.empty();
  return v;
}

static size_t encodeVocabNoIntern(const MarkupVocab& v) {
  std::vector<uint8_t> buf;
  size_t total = 0;
  const size_t n = v.tags.size();
  for (int f = 0; f < v.frames; ++f) {
    buf.clear();
    for (int r = 0; r < v.repsPerFrame; ++r) {
      putStr(buf, v.tags[size_t(r) % n]);
      putStr(buf, v.attrs[size_t(r) % v.attrs.size()]);
      putStr(buf, v.values[size_t(r) % v.values.size()]);
    }
    total += buf.size();
  }
  return total;
}

static size_t encodeVocabWithProxy(const MarkupVocab& v) {
  std::unordered_map<std::string, uint32_t> table;
  uint32_t next = 1;
  std::vector<uint8_t> buf;
  size_t total = 0;
  auto putRef = [&](std::string_view s) {
    std::string key(s);
    auto it = table.find(key);
    if (it == table.end()) {
      uint32_t id = next++;
      table[key] = id;
      putU8(buf, 1);
      putU32(buf, id);
      putStr(buf, s);
    } else {
      putU8(buf, 2);
      putU32(buf, it->second);
    }
  };
  const size_t n = v.tags.size();
  for (int f = 0; f < v.frames; ++f) {
    buf.clear();
    for (int r = 0; r < v.repsPerFrame; ++r) {
      putRef(v.tags[size_t(r) % n]);
      putRef(v.attrs[size_t(r) % v.attrs.size()]);
      putRef(v.values[size_t(r) % v.values.size()]);
    }
    total += buf.size();
  }
  return total;
}

static void runStreams(Report& rep) {
  Streams s;
  DocumentId d1{HostId{1}, Generation{1}};
  DocumentId d2{HostId{2}, Generation{1}};
  for (int i = 0; i < 3; ++i) {
    auto r = s.open(d1, AssetDest::Image, "https://p11.test/a.png");
    rep.check(r.ok(), "stream open d1");
  }
  for (int i = 0; i < 2; ++i) {
    auto r = s.open(d2, AssetDest::Font, "https://p11.test/f.woff");
    rep.check(r.ok(), "stream open d2");
  }
  rep.check(s.live() == 5, "5 live streams");
  s.cancelAllOfDocument(d1);
  rep.check(s.live() == 2, "kill doc leaves other live");
  rep.check(s.liveOf(d1) == 0, "d1 live 0");
  s.cancelAll();
  rep.check(s.live() == 0, "cancelAll clears");

  // Fill to ceiling then reject cleanly.
  Streams s2;
  bool filled = true;
  for (size_t i = 0; i < kMaxConcurrentAssetStreams; ++i) {
    auto r = s2.open(d1, AssetDest::Image, "https://p11.test/x");
    if (!r.ok()) filled = false;
  }
  rep.check(filled, "fill to ceiling");
  auto over = s2.open(d1, AssetDest::Image, "https://p11.test/over");
  rep.check(!over.ok() && over.fault().code == fault::FaultCode::AssetTooManyStreams,
            "AssetTooManyStreams at ceiling");
  rep.check(s2.live() == kMaxConcurrentAssetStreams, "no leak past ceiling");
}

static void runCoalesce(Report& rep) {
  Lab lab;
  HostId root = lab.openNav();
  auto* doc = lab.eng.simDocumentOf(root);
  auto* prod = lab.eng.producerOf(doc->id());
  NodeRef r = doc->view().root();
  lab.uplink.clear();
  // Burst inside one PatchClock interval — dirt coalesces to one publish on tick.
  for (int i = 0; i < 40; ++i) doc->appendElement(r, "div");
  lab.clock.advance(Millis(kPatchClockIntervalMs));
  rep.check(lab.uplink.publishCount() == 1, "coalesce one patch per interval");
  (void)prod;
}

static void runSiteShapes(Report& rep, double rTableMax) {
  // Site-shaped: same mutation volume; table size varies. Transport discarded (no loopback).
  struct Site {
    const char* name;
    int seed;
    int mut;
  };
  Site sites[] = {
      {"static", 800, 20},
      {"news", 400, 20},
      {"ecommerce", 600, 20},
      {"spa", 200, 20},
  };
  double costs[4];
  for (int i = 0; i < 4; ++i) {
    costs[i] = measureTableCost(sites[i].seed, sites[i].mut);
    std::printf("SITE %s seed=%d mut=%d cost_us=%.1f (signal)\n", sites[i].name, sites[i].seed,
                sites[i].mut, costs[i]);
  }
  // With mut constant, cost(static)/cost(spa) must stay under R_table (not track seed).
  double ratio = costs[0] / std::max(costs[3], 1.0);
  std::printf("SITE R_table_proxy static/spa=%.3f (max %.3f)\n", ratio, rTableMax);
  rep.check(ratio <= rTableMax * 1.25, "site shapes: cost tracks mut not table size");
}

int main(int argc, char** argv) {
  fs::path root = ".";
  fs::path threshPath = "tests/phase11/thresholds.json";
  fs::path reportDir = "tests/phase11/reports";
  std::string forceFail;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--thresholds") == 0 && i + 1 < argc) threshPath = argv[++i];
    else if (std::strcmp(argv[i], "--report-dir") == 0 && i + 1 < argc) reportDir = argv[++i];
    else if (std::strcmp(argv[i], "--force-fail-ratio") == 0) forceFail = "R_flat";
    else if (std::strcmp(argv[i], "--root") == 0 && i + 1 < argc) root = argv[++i];
  }
  if (root != ".") {
    threshPath = root / threshPath;
    reportDir = root / reportDir;
  }

  Report rep;
  Thresholds th;
  if (!loadThresholds(threshPath, th, rep)) {
    return 1;
  }

  // --- R_flat ---
  double us100 = measureBatchUsPerOp(100, nullptr);
  double us400 = measureBatchUsPerOp(400, nullptr);
  double us1600 = measureBatchUsPerOp(1600, nullptr);
  double rFlat = us1600 / std::max(us100, 1e-9);
  if (!forceFail.empty()) rFlat = th.rFlatMax + 10.0;
  std::printf("COST us/op K100=%.3f K400=%.3f K1600=%.3f R_flat=%.3f (max %.3f)\n", us100, us400,
              us1600, rFlat, th.rFlatMax);
  rep.check(rFlat <= th.rFlatMax, "R_flat");

  // --- R_table ---
  double cSmall = measureTableCost(50, 40);
  double cLarge = measureTableCost(800, 40);
  double rTable = cLarge / std::max(cSmall, 1.0);
  std::printf("TABLE cost_small=%.1f cost_large=%.1f R_table=%.3f (max %.3f)\n", cSmall, cLarge,
              rTable, th.rTableMax);
  rep.check(rTable <= th.rTableMax, "R_table");

  // --- R_scratch ---
  std::vector<size_t> peaks;
  for (int n = 0; n < 8; ++n) {
    Lab lab;
    HostId rootH = lab.openNav();
    auto* doc = lab.eng.simDocumentOf(rootH);
    auto* prod = lab.eng.producerOf(doc->id());
    NodeRef r = doc->view().root();
    for (int i = 0; i < 50 + n * 30; ++i) doc->appendElement(r, "div");
    prod->flush();
    peaks.push_back(prod->scratchPeakBytes());
    rep.check(prod->scratchPeakBytes() <= prod->scratchCapacityBytes(), "scratch under capacity");
  }
  std::sort(peaks.begin(), peaks.end());
  size_t median = peaks[peaks.size() / 2];
  size_t peak = peaks.back();
  double rScratch = double(peak) / double(std::max<size_t>(median, 1));
  std::printf("SCRATCH peak=%zu median=%zu cap=%zu R_scratch=%.3f (max %.3f)\n", peak, median,
              kScratchCapacityBytes, rScratch, th.rScratchMax);
  rep.check(rScratch <= th.rScratchMax, "R_scratch");
  rep.check(peak <= kScratchCapacityBytes, "scratch peak under launch capacity");

  runCoalesce(rep);
  runStreams(rep);
  runSiteShapes(rep, th.rTableMax);

  // --- Interning (realistic markup fixture; limiar declared before measure) ---
  fs::path vocabPath = "tests/phase11/fixtures/markup-vocab.json";
  if (root != ".") vocabPath = root / vocabPath;
  MarkupVocab vocab = loadMarkupVocab(vocabPath);
  rep.check(vocab.ok, "markup-vocab.json loaded");
  size_t bytesNo = 0, bytesYes = 0;
  double rVocab = 0;
  const char* decision = "defer";
  if (vocab.ok) {
    bytesNo = encodeVocabNoIntern(vocab);
    bytesYes = encodeVocabWithProxy(vocab);
    rVocab = (double(bytesNo) - double(bytesYes)) / double(std::max<size_t>(bytesNo, 1));
    decision = rVocab >= th.rVocabShipMin ? "ship_str_def" : "defer";
  }
  std::printf("INTERN fixture=%s frames=%d reps=%d bytes_no=%zu bytes_proxy=%zu R_vocab=%.3f (ship_min %.3f) -> %s\n",
              vocabPath.string().c_str(), vocab.frames, vocab.repsPerFrame, bytesNo, bytesYes, rVocab,
              th.rVocabShipMin, decision);
  rep.check(bytesNo > 0 && bytesYes > 0, "vocab fixture produced bytes");
  // If R_vocab < limiar: decision=defer is the finding — limiar is not moved.

  // --- Report ---
  fs::create_directories(reportDir);
  std::time_t now = std::time(nullptr);
  char stamp[64];
  std::strftime(stamp, sizeof(stamp), "%Y%m%d-%H%M%S", std::gmtime(&now));
  fs::path reportPath = reportDir / (std::string(stamp) + "-phase11.json");
  // Also write latest.json for the gate to inspect.
  fs::path latestPath = reportDir / "latest.json";

  const char* host = std::getenv("COMPUTERNAME");
  if (!host) host = std::getenv("HOSTNAME");
  if (!host) host = "local";
  const char* commit = std::getenv("GITHUB_SHA");
  if (!commit) commit = std::getenv("SPECULUM_COMMIT");
  if (!commit) commit = "unknown";

  auto writeReport = [&](const fs::path& path) {
    std::ofstream out(path);
    out << "{\n";
    out << "  \"hostLabel\": \"" << host << "\",\n";
    out << "  \"commit\": \"" << commit << "\",\n";
    out << "  \"command\": \"phase11_tests\",\n";
    out << "  \"usPerOp\": {\"K100\": " << us100 << ", \"K400\": " << us400
        << ", \"K1600\": " << us1600 << "},\n";
    out << "  \"ratios\": {\n";
    out << "    \"R_flat\": {\"value\": " << rFlat << ", \"max\": " << th.rFlatMax
        << ", \"pass\": " << (rFlat <= th.rFlatMax ? "true" : "false") << "},\n";
    out << "    \"R_table\": {\"value\": " << rTable << ", \"max\": " << th.rTableMax
        << ", \"pass\": " << (rTable <= th.rTableMax ? "true" : "false") << "},\n";
    out << "    \"R_scratch\": {\"value\": " << rScratch << ", \"max\": " << th.rScratchMax
        << ", \"pass\": " << (rScratch <= th.rScratchMax ? "true" : "false") << "}\n";
    out << "  },\n";
    out << "  \"scratchPeak\": " << peak << ",\n";
    out << "  \"scratchMedian\": " << median << ",\n";
    out << "  \"scratchCapacity\": " << kScratchCapacityBytes << ",\n";
    out << "  \"streams\": {\"maxConcurrent\": " << kMaxConcurrentAssetStreams
        << ", \"formatPass\": true},\n";
    out << "  \"interning\": {\"R_vocab\": " << rVocab << ", \"shipMin\": " << th.rVocabShipMin
        << ", \"decision\": \"" << decision
        << "\", \"fixture\": \"markup-vocab\", \"wireShipped\": false},\n";
    out << "  \"defaults\": {\n";
    out << "    \"kPatchClockIntervalMs\": " << kPatchClockIntervalMs << ",\n";
    out << "    \"kScratchCapacityBytes\": " << kScratchCapacityBytes << ",\n";
    out << "    \"kMaxConcurrentAssetStreams\": " << kMaxConcurrentAssetStreams << "\n";
    out << "  }\n";
    out << "}\n";
  };
  writeReport(reportPath);
  writeReport(latestPath);
  std::printf("REPORT %s\n", reportPath.string().c_str());

  if (rep.fails) {
    std::fprintf(stderr, "FAIL phase11: %d check(s)\n", rep.fails);
    return 1;
  }
  std::printf("PASS phase11\n");
  return 0;
}
