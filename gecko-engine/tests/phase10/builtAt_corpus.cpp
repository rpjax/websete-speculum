// Phase 10 A3 — SpecDriver corpus for ProjectionClient builtAt test (sim, no libxul).
#include <span>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "domain/documents/Hosts.hpp"
#include "domain/oracle/Capabilities.hpp"
#include "domain/producer/Resync.hpp"
#include "domain/roteiro/Parse.hpp"
#include "domain/roteiro/Runner.hpp"
#include "domain/roteiro/SpecDriver.hpp"
#include "domain/wire/Cursor.hpp"
#include "domain/wire/gen/SpeculumWire.gen.hpp"
#include "engines/sim/SimEngine.hpp"
#include "engines/sim/SimStateCapture.hpp"
#include "engines/sim/SimStateFreezer.hpp"

using namespace speculum;
using namespace speculum::oracle;
using namespace speculum::roteiro;
using namespace speculum::wire;

struct SimOnlyTraits {
  using Engine = sim::SimEngine;
  using Document = sim::SimDocument;
  using Freezer = sim::SimStateFreezer;
  using Capture = sim::SimStateCapture;
  static Document* documentOf(Engine& e, HostId h) { return e.simDocumentOf(h); }
  static Hosts& hosts(Engine& e) { return e.hosts(); }
};

static std::string b64(const uint8_t* p, size_t n) {
  static const char* T =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string o;
  size_t i = 0;
  while (i + 2 < n) {
    uint32_t v = (uint32_t(p[i]) << 16) | (uint32_t(p[i + 1]) << 8) | p[i + 2];
    o.push_back(T[(v >> 18) & 63]);
    o.push_back(T[(v >> 12) & 63]);
    o.push_back(T[(v >> 6) & 63]);
    o.push_back(T[v & 63]);
    i += 3;
  }
  if (i < n) {
    uint32_t v = uint32_t(p[i]) << 16;
    o.push_back(T[(v >> 18) & 63]);
    if (i + 1 < n) {
      v |= uint32_t(p[i + 1]) << 8;
      o.push_back(T[(v >> 12) & 63]);
      o.push_back(T[(v >> 6) & 63]);
      o.push_back('=');
    } else {
      o.push_back(T[(v >> 12) & 63]);
      o.push_back('=');
      o.push_back('=');
    }
  }
  return o;
}

static std::vector<uint8_t> packSchemaPatch(uint32_t generation, uint32_t sequence,
                                            uint16_t flags, uint32_t builtAt,
                                            std::span<const uint8_t> deltas) {
  Patch msg{};
  msg.generation = generation;
  msg.sequence = sequence;
  msg.flags = flags;
  msg.builtAt = builtAt;
  msg.metrics_count = 0;
  msg.deltas = deltas;
  std::vector<uint8_t> payload(64 * 1024 + deltas.size());
  Writer w(std::span<uint8_t>(payload.data(), payload.size()));
  if (!encode_Patch(w, msg)) return {};
  auto written = w.written();
  std::vector<uint8_t> out(16 + written.size());
  uint16_t op = Patch::kOpcode;
  out[0] = uint8_t(op);
  out[1] = uint8_t(op >> 8);
  out[2] = 0;
  out[3] = 0;
  uint32_t target = 1;
  for (int i = 0; i < 4; ++i) out[4 + i] = uint8_t(target >> (8 * i));
  uint32_t len = uint32_t(written.size());
  for (int i = 0; i < 4; ++i) out[8 + i] = uint8_t(len >> (8 * i));
  for (int i = 0; i < 4; ++i) out[12 + i] = 0;
  std::memcpy(out.data() + 16, written.data(), written.size());
  return out;
}

int main(int argc, char** argv) {
  if (argc < 2 || !argv[1] || !argv[1][0]) {
    std::fprintf(stderr,
                 "FAIL builtAt_corpus: usage: builtAt_corpus OUT.json [fixture.spec]\n"
                 "  OUT path must be explicit (SPECULUM_PHASE10_CORPUS). No implicit roots.\n");
    return 2;
  }
  const char* outPath = argv[1];
  const char* fixtures =
      argc > 2 ? argv[2] : "tests/phase7/fixtures/correcao/attr-text.spec";

  std::ifstream in(fixtures, std::ios::binary);
  if (!in) {
    std::fprintf(stderr, "FAIL cannot open fixture %s\n", fixtures);
    return 1;
  }
  std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  if (text.size() >= 3 && (unsigned char)text[0] == 0xEF) text.erase(0, 3);

  auto parsed = parseSpec(text);
  if (!parsed.ok) {
    std::fprintf(stderr, "FAIL parse: %s\n", parsed.error.message.c_str());
    return 1;
  }

  auto schema = loadSchemaHash("domain/wire/gen/schema.sha256");
  parsed.file.schemaHash = schema;
  Capabilities caps;
  caps.enable(Cap::Postcondition);
  SpecDriverT<SimOnlyTraits> drv(schema);
  drv.enablePostcondition(true);
  auto dr = drv.replay(parsed.file, caps, true);
  if (!dr.ok) {
    std::fprintf(stderr, "FAIL SpecDriver: %s\n", dr.message.c_str());
    return 1;
  }
  if (dr.patches.empty()) {
    std::fprintf(stderr, "FAIL SpecDriver zero patches\n");
    return 1;
  }

  const uint32_t builtAt = uint32_t(dr.patches.size());

  // Force producer resync after live stream — portrait for builtAt discard.
  drv.uplink().clear();
  auto* prod = drv.activeProducer();
  if (!prod) {
    std::fprintf(stderr, "FAIL no active producer after replay\n");
    return 1;
  }
  auto rr = prod->resync(producer::ResyncForce::FromWalk, prod->view().root());
  if (!rr.ok()) {
    std::fprintf(stderr, "FAIL producer resync: %s\n", rr.fault().message);
    return 1;
  }
  const auto& resyncPatches = drv.uplink().patches();
  if (resyncPatches.empty()) {
    std::fprintf(stderr, "FAIL resync published zero patches\n");
    return 1;
  }
  const auto& portrait = resyncPatches.back();

  // Oracle: apply ordinary stream then resync portrait (same order the healthy client expects).
  std::vector<uint8_t> oracle;
  for (const auto& p : dr.patches) oracle.insert(oracle.end(), p.begin(), p.end());
  oracle.insert(oracle.end(), portrait.begin(), portrait.end());

  // Oracle dump = producer Snapshot of table after resync (structural, stable).
  auto snap = prod->snapshot();

  std::ofstream out(outPath);
  if (!out) {
    std::fprintf(stderr, "FAIL cannot write %s\n", outPath);
    return 1;
  }
  out << "{\n";
  out << "  \"schema\": \"" << schema << "\",\n";
  out << "  \"fixture\": \"" << fixtures << "\",\n";
  out << "  \"tableHash\": \"" << prod->table().tableHash() << "\",\n";
  out << "  \"builtAt\": " << builtAt << ",\n";
  out << "  \"oracleIsaB64\": \"" << b64(oracle.data(), oracle.size()) << "\",\n";
  out << "  \"oracleDumpB64\": \"" << b64(snap.data(), snap.size()) << "\",\n";
  out << "  \"patches\": [\n";
  for (size_t i = 0; i < dr.patches.size(); ++i) {
    uint32_t seq = uint32_t(i + 1);
    auto packed = packSchemaPatch(1, seq, 0, 0, dr.patches[i]);
    if (packed.empty()) {
      std::fprintf(stderr, "FAIL encode patch %zu\n", i);
      return 1;
    }
    out << "    {\"sequence\": " << seq << ", \"envelopeB64\": \""
        << b64(packed.data(), packed.size()) << "\"}";
    out << (i + 1 < dr.patches.size() ? ",\n" : "\n");
  }
  out << "  ],\n";

  auto resyncPacked =
      packSchemaPatch(1, builtAt + 1, /*Resync*/ 0b10, builtAt, portrait);
  if (resyncPacked.empty()) {
    std::fprintf(stderr, "FAIL encode resync\n");
    return 1;
  }
  out << "  \"resyncEnvelopeB64\": \"" << b64(resyncPacked.data(), resyncPacked.size())
      << "\",\n";
  out << "  \"patchCount\": " << dr.patches.size() << ",\n";
  out << "  \"oracleDumpBytes\": " << snap.size() << "\n";
  out << "}\n";

  if (snap.empty()) {
    std::fprintf(stderr, "FAIL empty oracle dump\n");
    return 1;
  }
  std::printf("PASS builtAt_corpus patches=%zu builtAt=%u dump=%zu tableHash=%llu\n",
              dr.patches.size(), builtAt, snap.size(),
              (unsigned long long)prod->table().tableHash());
  return 0;
}
