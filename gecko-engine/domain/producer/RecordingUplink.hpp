#pragma once

#include <cstdint>
#include <vector>

#include "ports/IPatchUplink.hpp"

namespace speculum::producer {

class RecordingUplink final : public IPatchUplink {
 public:
  void setDrained(bool v) { drained_ = v; }
  bool isDrained() const override { return drained_; }

  void publish(DocumentId doc, uint32_t sequence,
               std::span<const uint8_t> patch) override {
    ++publish_count_;
    last_doc_ = doc;
    last_sequence_ = sequence;
    last_patch_.assign(patch.begin(), patch.end());
    patches_.push_back(last_patch_);
    sequences_.push_back(sequence);
  }

  void publishSnapshot(DocumentId doc, CorrelationId corr,
                       const SnapshotHeader& header,
                       std::span<const uint8_t> body) override {
    ++snapshot_count_;
    last_doc_ = doc;
    last_corr_ = corr;
    last_header_ = header;
    last_snapshot_.assign(body.begin(), body.end());
  }

  int publishCount() const { return publish_count_; }
  int snapshotCount() const { return snapshot_count_; }
  uint32_t lastSequence() const { return last_sequence_; }
  DocumentId lastDoc() const { return last_doc_; }
  const std::vector<uint8_t>& lastPatch() const { return last_patch_; }
  const std::vector<uint8_t>& lastSnapshot() const { return last_snapshot_; }
  const std::vector<std::vector<uint8_t>>& patches() const { return patches_; }
  const SnapshotHeader& lastHeader() const { return last_header_; }

  void clear() {
    publish_count_ = 0;
    snapshot_count_ = 0;
    patches_.clear();
    sequences_.clear();
    last_patch_.clear();
    last_snapshot_.clear();
  }

 private:
  bool drained_{true};
  int publish_count_{0};
  int snapshot_count_{0};
  DocumentId last_doc_{};
  CorrelationId last_corr_{0};
  uint32_t last_sequence_{0};
  SnapshotHeader last_header_{};
  std::vector<uint8_t> last_patch_;
  std::vector<uint8_t> last_snapshot_;
  std::vector<std::vector<uint8_t>> patches_;
  std::vector<uint32_t> sequences_;
};

}  // namespace speculum::producer
