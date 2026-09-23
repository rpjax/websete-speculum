#pragma once

#include <fstream>
#include <string>
#include <string_view>
#include <vector>

#include "domain/producer/Producer.hpp"
#include "domain/producer/RecordingUplink.hpp"
#include "domain/roteiro/CauseSpan.hpp"
#include "domain/roteiro/Parse.hpp"
#include "domain/roteiro/Recorder.hpp"
#include "domain/roteiro/Symbols.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "ports/IAssetReader.hpp"

// Concrete engines live in the test layer (tests/phase7/EngineTraits.hpp).
// RunnerT is Traits-parameterized — domain must not include engines/** (02-camadas).

namespace speculum::roteiro {

inline std::string loadSchemaHash(std::string_view path) {
  std::ifstream in{std::string(path)};
  std::string h;
  std::getline(in, h);
  while (!h.empty() && (h.back() == '\r' || h.back() == '\n' || h.back() == ' '))
    h.pop_back();
  return h;
}

struct RunResult {
  bool ok{true};
  std::string message;
  std::string recordedText;
  std::vector<uint8_t> lastPatch;
};

// Scenario: open viewport, navigate, mutate DOM, flush patches — used by record/check.
struct Scenario {
  std::string url{"https://example.com"};
  int childCount{1};
  bool haltCoalesce{false};
};

template <typename Traits>
class RunnerT {
 public:
  using Engine = typename Traits::Engine;

  explicit RunnerT(std::string schemaHash) : schema_(std::move(schemaHash)) {}

  // record: drive engine, return .spec text
  RunResult record(const Scenario& sc, BlobStore* blobs = nullptr) {
    RunResult rr;
    ManualClock clock;
    producer::RecordingUplink uplink;
    SpecRecorder rec(blobs);
    rec.setSchema(schema_);
    rec.setSeed(1);

    RecordingClock rclock(clock, &rec);
    RecordingPatchUplink ruplink(uplink, &rec);

    Engine eng;
    eng.setProducerDeps(&rclock, &ruplink);

    auto pSym = rec.symbols().mint(SymKind::Process);
    rec.noteTime(0);
    rec.noteIn(EventName::HostProcessAttach, pSym);

    HostId root{};
    auto vr = eng.openViewport(Extent{1280, 720}, &root);
    if (!vr.ok()) {
      rr.ok = false;
      rr.message = "openViewport failed";
      return rr;
    }
    auto vSym = rec.symbols().intern(SymKind::Viewport, vr.value().value());
    auto fSym = rec.symbols().intern(SymKind::Frame, root.value());
    rec.noteIn(EventName::HostViewportOpen, vSym + " " + fSym + " 1280x720");

    if (!eng.doNavigate(root, sc.url, 1).ok()) {
      rr.ok = false;
      rr.message = "navigate failed";
      return rr;
    }
    rec.noteTime(4);
    rec.noteIn(EventName::FrameLoadStart, fSym);
    eng.emitLoadStarted(root);
    rec.noteTime(120);
    auto* doc = Traits::documentOf(eng, root);
    auto* prod = eng.producerOf(doc->id());
    auto dSym = rec.symbols().intern(
        SymKind::Document,
        (uint64_t(doc->id().host.value()) << 32) | doc->id().generation.value);
    rec.noteIn(EventName::FrameDocumentInstall, fSym + " " + dSym + " process=" + pSym);
    eng.emitLoadStopped(root, true);
    rec.noteIn(EventName::FrameLoadStop, fSym + " ok");

    if (sc.haltCoalesce && prod) prod->patchClock().halt();

    rec.noteTime(121);
    NodeRef r = doc->view().root();
    auto nRoot = rec.symbols().intern(SymKind::Node, r.value());
    for (int i = 0; i < sc.childCount; ++i) {
      auto child = doc->appendElement(r, "div");
      auto nChild = rec.symbols().intern(SymKind::Node, child.value());
      rec.noteIn(EventName::DocChildInsert,
                 dSym + " parent=" + nRoot + " child=" + nChild);
    }

    if (sc.haltCoalesce && prod) {
      rec.noteTime(150);
      prod->patchClock().resume();
    } else if (prod) {
      rec.noteTime(137);
      clock.advance(200);
      prod->flush();
    }

    if (!uplink.lastPatch().empty()) rr.lastPatch = uplink.lastPatch();
    rr.recordedText = rec.toText();
    rr.ok = true;
    return rr;
  }

  // check: parse expected, re-record same scenario, compare output lines
  RunResult check(std::string_view expectedText, const Scenario& sc,
                  BlobStore* blobs = nullptr) {
    RunResult rr;
    auto parsed = parseSpec(expectedText);
    if (!parsed.ok) {
      rr.ok = false;
      rr.message = "parse: " + parsed.error.message + " at " +
                   std::to_string(parsed.error.lineNo);
      return rr;
    }
    if (parsed.file.schemaHash != schema_) {
      rr.ok = false;
      rr.message = "schema mismatch: refuse replay";
      return rr;
    }

    CauseSpan spans;
    spans.assignAll(parsed.file.lines);

    auto got = record(sc, blobs);
    if (!got.ok) return got;

    auto gotParsed = parseSpec(got.recordedText);
    if (!gotParsed.ok) {
      rr.ok = false;
      rr.message = "re-record parse failed";
      return rr;
    }

    std::vector<const SpecLine*> expOut, gotOut;
    for (const auto& l : parsed.file.lines)
      if (l.kind == LineKind::Out) expOut.push_back(&l);
    for (const auto& l : gotParsed.file.lines)
      if (l.kind == LineKind::Out) gotOut.push_back(&l);

    size_t n = expOut.size() < gotOut.size() ? expOut.size() : gotOut.size();
    for (size_t i = 0; i < n; ++i) {
      auto canon = [](const SpecLine& l) { return l.eventName + " " + l.args; };
      if (canon(*expOut[i]) != canon(*gotOut[i])) {
        rr.ok = false;
        rr.message = spans.report(expOut[i]->lineNo, expOut[i]->spanId, parsed.file.lines);
        rr.message += "expected: < " + canon(*expOut[i]) + "\n";
        rr.message += "got:      < " + canon(*gotOut[i]) + "\n";
        return rr;
      }
    }
    if (expOut.size() != gotOut.size()) {
      rr.ok = false;
      rr.message = "output count diverge exp=" + std::to_string(expOut.size()) +
                   " got=" + std::to_string(gotOut.size());
      return rr;
    }
    rr.ok = true;
    rr.recordedText = got.recordedText;
    return rr;
  }

  RunResult checkRefuseBadSchema(std::string_view text) {
    RunResult rr;
    auto parsed = parseSpec(text);
    if (!parsed.ok) {
      rr.ok = false;
      rr.message = parsed.error.message;
      return rr;
    }
    if (parsed.file.schemaHash != schema_) {
      rr.ok = false;
      rr.message = "schema mismatch: refuse replay";
      return rr;
    }
    rr.ok = true;
    return rr;
  }

 private:
  std::string schema_;
};

// Stub asset reader for port completeness.
class NullAssetReader final : public IAssetReader {
 public:
  Result<void> open(StreamId, std::string_view, DocumentId) override {
    return Result<void>::success();
  }
  Result<void> cancel(StreamId) override { return Result<void>::success(); }
};

}  // namespace speculum::roteiro
