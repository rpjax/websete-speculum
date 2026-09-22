#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "domain/ids/Ids.hpp"
#include "domain/roteiro/BlobStore.hpp"
#include "domain/roteiro/CauseSpan.hpp"
#include "domain/roteiro/Parse.hpp"
#include "domain/roteiro/Symbols.hpp"
#include "domain/roteiro/Types.hpp"
#include "ports/IClock.hpp"
#include "ports/IPatchUplink.hpp"

namespace speculum::roteiro {

// Collects lines for record mode. Thread: main only.
class SpecRecorder {
 public:
  explicit SpecRecorder(BlobStore* blobs = nullptr) : blobs_(blobs) {}

  void setSchema(std::string hash) { schema_ = std::move(hash); }
  void setSeed(uint64_t s) { seed_ = s; }

  SymbolTable& symbols() { return sym_; }
  CauseSpan& spans() { return spans_; }

  void noteTime(uint64_t absMs) {
    SpecLine l;
    l.kind = LineKind::Time;
    l.timeMs = absMs;
    l.lineNo = nextLine_++;
    spans_.onLine(l);
    lines_.push_back(std::move(l));
  }

  void noteIn(EventName e, std::string args) {
    SpecLine l;
    l.kind = LineKind::In;
    l.event = e;
    l.eventName = eventNameStr(e);
    l.args = std::move(args);
    l.raw = l.eventName + (l.args.empty() ? "" : "  " + l.args);
    l.lineNo = nextLine_++;
    spans_.onLine(l);
    lines_.push_back(std::move(l));
  }

  void noteOut(EventName e, std::string args) {
    SpecLine l;
    l.kind = LineKind::Out;
    l.event = e;
    l.eventName = eventNameStr(e);
    l.args = std::move(args);
    l.raw = l.eventName + (l.args.empty() ? "" : "  " + l.args);
    l.lineNo = nextLine_++;
    spans_.onLine(l);
    lines_.push_back(std::move(l));
  }

  void notePatch(const std::string& docSym, uint32_t seq, const std::vector<uint8_t>& bytes) {
    std::string payload;
    if (blobs_ && bytes.size() > kBlobThreshold) {
      payload = blobs_->store(bytes);
    } else {
      payload = BlobStore::toHex(bytes);
    }
    noteOut(EventName::Patch, docSym + " seq=" + std::to_string(seq) + " " + payload);
  }

  void noteClockArm(const std::string& tSym, Millis delay) {
    noteOut(EventName::ClockArm, tSym + " +" + std::to_string(delay));
  }

  void noteClockCancel(const std::string& tSym) {
    noteOut(EventName::ClockCancel, tSym);
  }

  SpecFile toFile() const {
    SpecFile f;
    f.version = 1;
    f.schemaHash = schema_;
    f.seed = seed_;
    SpecLine d1;
    d1.kind = LineKind::Directive;
    d1.dir = DirKind::Roteiro;
    d1.dirValue = "1";
    f.lines.push_back(d1);
    SpecLine d2;
    d2.kind = LineKind::Directive;
    d2.dir = DirKind::Schema;
    d2.dirValue = schema_;
    f.lines.push_back(d2);
    SpecLine d3;
    d3.kind = LineKind::Directive;
    d3.dir = DirKind::Seed;
    d3.dirValue = std::to_string(seed_);
    f.lines.push_back(d3);
    for (const auto& l : lines_) f.lines.push_back(l);
    return f;
  }

  std::string toText() const { return writeSpec(toFile()); }

  const std::vector<SpecLine>& lines() const { return lines_; }
  void clear() {
    lines_.clear();
    nextLine_ = 1;
    sym_.reset();
  }

 private:
  BlobStore* blobs_{nullptr};
  SymbolTable sym_;
  CauseSpan spans_;
  std::vector<SpecLine> lines_;
  int nextLine_{1};
  std::string schema_;
  uint64_t seed_{1};
};

// IPatchUplink decorator: forwards + records patch lines.
class RecordingPatchUplink final : public IPatchUplink {
 public:
  RecordingPatchUplink(IPatchUplink& inner, SpecRecorder* rec)
      : inner_(inner), rec_(rec) {}

  void publish(DocumentId doc, uint32_t sequence,
               std::span<const uint8_t> patch) override {
    if (rec_) {
      auto d = rec_->symbols().intern(
          SymKind::Document,
          (uint64_t(doc.host.value()) << 32) | doc.generation.value);
      std::vector<uint8_t> bytes(patch.begin(), patch.end());
      rec_->notePatch(d, sequence, bytes);
    }
    inner_.publish(doc, sequence, patch);
  }

  void publishSnapshot(DocumentId doc, CorrelationId corr,
                       const producer::SnapshotHeader& header,
                       std::span<const uint8_t> body) override {
    inner_.publishSnapshot(doc, corr, header, body);
  }

  bool isDrained() const override { return inner_.isDrained(); }

 private:
  IPatchUplink& inner_;
  SpecRecorder* rec_;
};

// IClock decorator: records arm/cancel; fire still from ManualClock.advance.
class RecordingClock final : public IClock {
 public:
  RecordingClock(IClock& inner, SpecRecorder* rec) : inner_(inner), rec_(rec) {}

  Millis now() const override { return inner_.now(); }

  TimerId scheduleOnce(Millis delay, ITimerTarget* target) override {
    auto id = inner_.scheduleOnce(delay, target);
    if (rec_) {
      auto t = rec_->symbols().intern(SymKind::Timer, id);
      rec_->noteClockArm(t, delay);
    }
    return id;
  }

  void cancel(TimerId id) override {
    if (rec_) {
      auto t = rec_->symbols().intern(SymKind::Timer, id);
      rec_->noteClockCancel(t);
    }
    inner_.cancel(id);
  }

 private:
  IClock& inner_;
  SpecRecorder* rec_;
};

}  // namespace speculum::roteiro
