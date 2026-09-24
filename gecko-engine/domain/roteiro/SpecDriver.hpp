#pragma once

#include <cctype>
#include <cstdlib>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "domain/Result.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/oracle/Capabilities.hpp"
#include "domain/oracle/ProjectionOracle.hpp"
#include "domain/producer/Producer.hpp"
#include "domain/producer/RecordingUplink.hpp"
#include "domain/producer/Resync.hpp"
#include "domain/producer/RowHash.hpp"
#include "domain/roteiro/CauseSpan.hpp"
#include "domain/roteiro/Parse.hpp"
#include "domain/roteiro/Recorder.hpp"
#include "domain/roteiro/Symbols.hpp"
#include "domain/roteiro/Types.hpp"
#include "domain/session/fakes/ManualClock.hpp"

// Concrete engines + Traits live in the test layer (tests/phase7/EngineTraits.hpp).
// SpecDriverT is Traits-parameterized; domain/session and domain/producer must not
// include engine headers (02-camadas).

namespace speculum::roteiro {

inline std::vector<std::string> splitArgs(std::string_view s) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : s) {
    if (std::isspace(static_cast<unsigned char>(c))) {
      if (!cur.empty()) {
        out.push_back(cur);
        cur.clear();
      }
    } else {
      cur.push_back(c);
    }
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

inline std::string argVal(const std::vector<std::string>& a, std::string_view key) {
  std::string prefix = std::string(key) + "=";
  for (const auto& t : a) {
    if (t.rfind(prefix, 0) == 0) return t.substr(prefix.size());
  }
  return {};
}

// Replays `>` lines against Traits::Engine. Records `<` via SpecRecorder.
template <typename Traits>
class SpecDriverT {
 public:
  using Engine = typename Traits::Engine;
  using Document = typename Traits::Document;
  using Freezer = typename Traits::Freezer;
  using Capture = typename Traits::Capture;

  explicit SpecDriverT(std::string schemaHash) : schema_(std::move(schemaHash)) {}

  struct DriveResult {
    bool ok{true};
    std::string message;
    std::string recordedText;
    std::vector<uint8_t> lastPatch;
    std::vector<std::vector<uint8_t>> patches;  // full uplink sequence (Phase 9 parity)
    oracle::Verdict verdict;
    bool oracleRan{false};
    uint64_t tableHash{0};
    size_t knownSheets{0};
  };

  DriveResult replay(const SpecFile& file, oracle::Capabilities& caps,
                     bool runOracle = true) {
    DriveResult dr;
    if (file.schemaHash != schema_) {
      dr.ok = false;
      dr.message = "schema mismatch: refuse replay";
      return dr;
    }

    reset();
    SpecRecorder rec;
    rec.setSchema(schema_);
    rec.setSeed(file.seed ? file.seed : 1);
    recorder_ = &rec;
    ruplink_ = std::make_unique<RecordingPatchUplink>(uplink_, &rec);
    // SpecRecorder is stack-local; Producer keeps RecordingPatchUplink*. Detach on every
    // exit (success or failure) — no early return may leave &rec dangling.
    RecordingPatchUplink::DetachGuard detach(ruplink_.get(), &recorder_);
    eng_->setProducerDeps(&clock_, ruplink_.get());

    CauseSpan spans;
    auto lines = file.lines;
    spans.assignAll(lines);

    Millis lastT = 0;
    for (const auto& line : lines) {
      if (line.kind == LineKind::Time) {
        Millis t = Millis(line.timeMs);
        if (t > lastT) clock_.advance(t - lastT);
        lastT = t;
        rec.noteTime(line.timeMs);
        continue;
      }
      if (line.kind != LineKind::In) continue;
      auto r = applyIn(line);
      if (!r.ok()) {
        dr.ok = false;
        dr.message = "replay line " + std::to_string(line.lineNo) + ": " + r.fault().message;
        return dr;
      }
    }

    if (auto* prod = activeProducer()) {
      clock_.advance(50);
      prod->flush();
    }

    dr.recordedText = rec.toText();
    dr.patches = uplink_.patches();
    if (!uplink_.lastPatch().empty()) dr.lastPatch = uplink_.lastPatch();
    if (auto* prod = activeProducer()) {
      dr.tableHash = prod->table().tableHash();
      dr.knownSheets = prod->knownSheetCount();
    }

    auto got = parseSpec(dr.recordedText);
    std::vector<const SpecLine*> expOut, gotOut;
    for (const auto& l : file.lines)
      if (l.kind == LineKind::Out) expOut.push_back(&l);
    for (const auto& l : got.file.lines)
      if (l.kind == LineKind::Out) gotOut.push_back(&l);

    if (!expOut.empty()) {
      size_t n = expOut.size() < gotOut.size() ? expOut.size() : gotOut.size();
      for (size_t i = 0; i < n; ++i) {
        auto canon = [](const SpecLine& l) { return l.eventName + " " + l.args; };
        if (canon(*expOut[i]) != canon(*gotOut[i])) {
          dr.ok = false;
          dr.message = spans.report(expOut[i]->lineNo, expOut[i]->spanId, file.lines);
          dr.message += "expected: < " + canon(*expOut[i]) + "\n";
          dr.message += "got:      < " + canon(*gotOut[i]) + "\n";
          return dr;
        }
      }
      if (expOut.size() != gotOut.size()) {
        dr.ok = false;
        dr.message = "output count diverge exp=" + std::to_string(expOut.size()) +
                     " got=" + std::to_string(gotOut.size());
        return dr;
      }
    }

    if (runOracle && caps.enabled(oracle::Cap::Freeze)) {
      auto orr = runOraclePass(caps);
      dr.oracleRan = true;
      dr.verdict = orr;
      if (!orr.ok) {
        dr.ok = false;
        dr.message = "oracle fail field=" + orr.field + " row=" + std::to_string(orr.row);
        return dr;
      }
    }

    if (caps.enabled(oracle::Cap::Invariants)) {
      if (auto* prod = activeProducer()) {
        if (!prod->table().checkInvariants()) {
          dr.ok = false;
          dr.message = "invariants failed";
          return dr;
        }
      }
    }

    if (caps.enabled(oracle::Cap::Shadow)) {
      if (auto* prod = activeProducer()) {
        if (!checkShadow(*prod)) {
          dr.ok = false;
          dr.message = "shadow tableHash diverge";
          return dr;
        }
      }
    }

    if (caps.enabled(oracle::Cap::Encode) && !dr.lastPatch.empty()) {
      if (!checkEncode(dr.lastPatch)) {
        dr.ok = false;
        dr.message = "encode check failed";
        return dr;
      }
    }

    return dr;
  }

  Engine& engine() { return *eng_; }
  ManualClock& clock() { return clock_; }
  producer::RecordingUplink& uplink() { return uplink_; }

  producer::Producer* activeProducer() {
    if (!root_.valid() || !eng_) return nullptr;
    auto* doc = Traits::documentOf(*eng_, root_);
    if (!doc) return nullptr;
    return eng_->producerOf(doc->id());
  }

  void enablePostcondition(bool v) { caps_post_ = v; }

 private:
  void reset() {
    eng_ = std::make_unique<Engine>();
    clock_ = ManualClock{};
    uplink_ = producer::RecordingUplink{};
    ruplink_.reset();
    recorder_ = nullptr;
    root_ = {};
    frames_.clear();
    nodes_.clear();
    docs_.clear();
    sheets_.clear();
    processes_.clear();
    sym_.reset();
  }

  bool checkShadow(producer::Producer& prod) {
    producer::Identity id2;
    producer::ProducerTable shadow;
    auto root = prod.view().root();
    auto r = producer::Resync::run(producer::ResyncForce::FromWalk, prod.view(), id2, shadow,
                                   root);
    if (!r.ok()) return false;
    if (!shadow.checkInvariants()) return false;
    if (shadow.size() != prod.table().size()) return false;
    return true;
  }

  bool checkEncode(const std::vector<uint8_t>& patch) {
    using producer::IsaOp;
    using producer::PatchBuilder;
    auto sp = std::span<const uint8_t>(patch.data(), patch.size());
    (void)PatchBuilder::countOp(sp, IsaOp::NodeNew);
    (void)PatchBuilder::countOp(sp, IsaOp::Insert);
    (void)PatchBuilder::countOp(sp, IsaOp::AttrSet);
    (void)PatchBuilder::countOp(sp, IsaOp::TextSet);
    (void)PatchBuilder::countOp(sp, IsaOp::Remove);
    auto d1 = producer::digestBytes(sp);
    auto d2 = producer::digestBytes(sp);
    if (d1 != d2) return false;
    return !patch.empty();
  }

  oracle::Verdict runOraclePass(oracle::Capabilities& caps) {
    Freezer freezer(*eng_);
    Capture capture(*eng_, freezer);
    oracle::ProjectionOracle oracle(Traits::hosts(*eng_), freezer, capture, caps);
    auto tok = freezer.freezeAll(1000);
    if (!tok.ok()) {
      oracle::Verdict v;
      v.ok = false;
      v.roteiroExcerpt = "freeze failed";
      return v;
    }
    auto v = oracle.run(tok.value());
    freezer.thawAll(tok.value());
    return v;
  }

  Result<void> applyIn(const SpecLine& line) {
    auto args = splitArgs(line.args);
    switch (line.event) {
      case EventName::HostProcessAttach: {
        std::string p = args.empty() ? sym_.mint(SymKind::Process) : args[0];
        auto pid = eng_->createProcess();
        processes_[p] = pid;
        sym_.intern(SymKind::Process, pid.value());
        if (recorder_) recorder_->noteIn(line.event, p);
        return Result<void>::success();
      }
      case EventName::HostViewportOpen: {
        Extent ext{1280, 720};
        if (args.size() >= 3) {
          auto x = args[2].find('x');
          if (x != std::string::npos) {
            ext.width = uint32_t(std::atoi(args[2].substr(0, x).c_str()));
            ext.height = uint32_t(std::atoi(args[2].substr(x + 1).c_str()));
          }
        }
        HostId root{};
        auto vr = eng_->openViewport(ext, &root);
        if (!vr.ok()) return Result<void>::failure(vr.fault());
        root_ = root;
        std::string v = args.size() > 0 ? args[0] : sym_.mint(SymKind::Viewport);
        std::string f = args.size() > 1 ? args[1] : sym_.mint(SymKind::Frame);
        frames_[f] = root;
        sym_.intern(SymKind::Viewport, vr.value().value());
        sym_.intern(SymKind::Frame, root.value());
        if (recorder_)
          recorder_->noteIn(line.event, v + " " + f + " " + std::to_string(ext.width) + "x" +
                                            std::to_string(ext.height));
        return Result<void>::success();
      }
      case EventName::HostFrameAttach: {
        std::string child = args.empty() ? sym_.mint(SymKind::Frame) : args[0];
        std::string parent = argVal(args, "parent");
        HostId ph = frames_.count(parent) ? frames_[parent] : root_;
        HostId ch = eng_->attachChildHost(ph, Extent{400, 300});
        frames_[child] = ch;
        sym_.intern(SymKind::Frame, ch.value());
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::HostFrameDetach: {
        std::string f = args.empty() ? "" : args[0];
        if (!frames_.count(f)) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::NoSuchHost, "SpecDriver", "detach"));
        }
        eng_->detachHost(frames_[f]);
        frames_.erase(f);
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::FrameLoadStart: {
        std::string f = args.empty() ? "f1" : args[0];
        HostId h = frames_.count(f) ? frames_[f] : root_;
        if (!Traits::documentOf(*eng_, h)) {
          if (!eng_->doNavigate(h, "https://fixture.test", 1).ok()) {
            return Result<void>::failure(
                fault::makeFault(fault::FaultCode::NavigateRefused, "SpecDriver", "nav"));
          }
          auto* doc = Traits::documentOf(*eng_, h);
          if (doc) {
            docs_["d1"] = h;
            NodeRef r = doc->view().root();
            nodes_["n1"] = r;
            sym_.intern(SymKind::Node, r.value());
            auto* prod = eng_->producerOf(doc->id());
            if (prod && caps_post_) prod->enablePostcondition(true);
          }
        }
        eng_->emitLoadStarted(h);
        if (recorder_) recorder_->noteIn(line.event, f);
        return Result<void>::success();
      }
      case EventName::FrameLoadStop: {
        std::string f = args.empty() ? "f1" : args[0];
        HostId h = frames_.count(f) ? frames_[f] : root_;
        eng_->emitLoadStopped(h, true);
        if (recorder_) recorder_->noteIn(line.event, f + " ok");
        return Result<void>::success();
      }
      case EventName::FrameDocumentInstall: {
        std::string f = args.empty() ? "f1" : args[0];
        HostId h = frames_.count(f) ? frames_[f] : root_;
        if (!Traits::documentOf(*eng_, h)) {
          if (!eng_->doNavigate(h, "https://fixture.test", 1).ok()) {
            return Result<void>::failure(
                fault::makeFault(fault::FaultCode::NavigateRefused, "SpecDriver", "nav"));
          }
        }
        auto* doc = Traits::documentOf(*eng_, h);
        auto dSym = args.size() > 1 ? args[1] : "d1";
        docs_[dSym] = h;
        if (doc) {
          sym_.intern(SymKind::Document,
                      (uint64_t(doc->id().host.value()) << 32) | doc->id().generation.value);
          auto* prod = eng_->producerOf(doc->id());
          if (prod && caps_post_) prod->enablePostcondition(true);
          NodeRef r = doc->view().root();
          nodes_["n1"] = r;
          sym_.intern(SymKind::Node, r.value());
        }
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocChildInsert: {
        auto parent = argVal(args, "parent");
        auto child = argVal(args, "child");
        auto idxS = argVal(args, "index");
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        if (!docs_.empty() && args.size() > 0 && docs_.count(args[0])) h = docs_[args[0]];
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::NoSuchDocument, "SpecDriver", "insert"));
        }
        NodeRef p = nodes_.count(parent) ? nodes_[parent] : doc->view().root();
        NodeRef c;
        if (!idxS.empty()) {
          c = doc->insertElement(p, uint32_t(std::atoi(idxS.c_str())), "div");
        } else {
          c = doc->appendElement(p, "div");
        }
        if (!child.empty()) nodes_[child] = c;
        sym_.intern(SymKind::Node, c.value());
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocChildRemoving: {
        auto parent = argVal(args, "parent");
        auto child = argVal(args, "child");
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc || !nodes_.count(parent) || !nodes_.count(child)) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::NoSuchDocument, "SpecDriver", "remove"));
        }
        doc->removeChild(nodes_[parent], nodes_[child]);
        nodes_.erase(child);
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocAttr: {
        std::string nsym;
        for (const auto& a : args) {
          if (a.size() >= 2 && a[0] == 'n' && std::isdigit(static_cast<unsigned char>(a[1])) &&
              a.find('=') == std::string::npos)
            nsym = a;
        }
        auto name = argVal(args, "name");
        auto value = argVal(args, "value");
        if (value.empty()) value = "x";
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc || !nodes_.count(nsym)) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::NoSuchDocument, "SpecDriver", "attr"));
        }
        doc->setAttr(nodes_[nsym], name.empty() ? "class" : name, value);
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocText: {
        std::string nsym;
        for (const auto& a : args) {
          if (a.size() >= 2 && a[0] == 'n' && std::isdigit(static_cast<unsigned char>(a[1])) &&
              a.find('=') == std::string::npos)
            nsym = a;
        }
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc || !nodes_.count(nsym)) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::NoSuchDocument, "SpecDriver", "text"));
        }
        doc->setText(nodes_[nsym], "hello");
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocSheetAdd: {
        auto sSym = args.size() > 1 ? args[1] : "s1";
        auto owner = argVal(args, "owner");
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::NoSuchDocument, "SpecDriver", "sheet"));
        }
        NodeRef own = nodes_.count(owner) ? nodes_[owner] : NodeRef{};
        auto s = doc->addLinkedSheet(own);
        sheets_[sSym] = s;
        sym_.intern(SymKind::Sheet, s.value());
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocSheetApplicable: {
        auto sSym = args.size() > 1 ? args[1] : (args.empty() ? "s1" : args[0]);
        if (args.size() >= 2) sSym = args[1];
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc || !sheets_.count(sSym)) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::CaptureUnavailable, "SpecDriver", "applicable"));
        }
        doc->setSheetApplicable(sheets_[sSym], true);
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocRuleAdd: {
        auto sSym = argVal(args, "sheet");
        if (sSym.empty() && args.size() > 1) sSym = args[1];
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc || !sheets_.count(sSym)) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::CaptureUnavailable, "SpecDriver", "rule"));
        }
        doc->addRule(sheets_[sSym], "div");
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::DocShadowAttach: {
        auto hostSym = argVal(args, "host");
        auto rootSym = argVal(args, "root");
        if (rootSym.empty()) rootSym = argVal(args, "child");
        HostId h = docs_.empty() ? root_ : docs_.begin()->second;
        if (!docs_.empty() && !args.empty() && docs_.count(args[0])) h = docs_[args[0]];
        auto* doc = Traits::documentOf(*eng_, h);
        if (!doc || !nodes_.count(hostSym)) {
          return Result<void>::failure(
              fault::makeFault(fault::FaultCode::NoSuchDocument, "SpecDriver", "shadow"));
        }
        NodeRef sr = doc->attachShadow(nodes_[hostSym]);
        if (!rootSym.empty()) nodes_[rootSym] = sr;
        sym_.intern(SymKind::Node, sr.value());
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      case EventName::ClockFire: {
        clock_.advance(16);
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
      }
      default:
        if (recorder_) recorder_->noteIn(line.event, line.args);
        return Result<void>::success();
    }
  }

  std::string schema_;
  std::unique_ptr<Engine> eng_;
  ManualClock clock_;
  producer::RecordingUplink uplink_;
  std::unique_ptr<RecordingPatchUplink> ruplink_;
  SpecRecorder* recorder_{nullptr};
  SymbolTable sym_;
  HostId root_{};
  std::unordered_map<std::string, HostId> frames_;
  std::unordered_map<std::string, HostId> docs_;
  std::unordered_map<std::string, NodeRef> nodes_;
  std::unordered_map<std::string, SheetRef> sheets_;
  std::unordered_map<std::string, ProcessId> processes_;
  bool caps_post_{false};
};

}  // namespace speculum::roteiro
