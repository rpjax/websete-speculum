#pragma once

#include <cstdint>

namespace speculum::producer {

// Sibling-proportional walks — the defect class, not a named function.
// Charge `steps` = how many siblings (or childAt slots) the walk examined.
// O(1) index/hint paths charge 0.
enum class SiblingScanPath : uint8_t {
  OnChildList = 0,      // mark: finding prev among siblings
  LivePrevSibling = 1,  // descriptor: walking parent children for prev
  Count = 2,
};

// Accumulates sibling-walk cost. Reset at producer construction and on demand.
// Flush window: reset at doFlush start; mark window accumulates between flushes.
struct SiblingScanMeter {
  void reset() {
    for (uint8_t i = 0; i < static_cast<uint8_t>(SiblingScanPath::Count); ++i) {
      steps_[i] = 0;
      events_[i] = 0;
    }
  }

  void note(SiblingScanPath path, uint32_t stepsExamined) {
    const auto i = static_cast<uint8_t>(path);
    if (i >= static_cast<uint8_t>(SiblingScanPath::Count)) return;
    if (stepsExamined == 0) return;
    steps_[i] += stepsExamined;
    ++events_[i];
  }

  uint64_t steps(SiblingScanPath path) const {
    return steps_[static_cast<uint8_t>(path)];
  }

  uint64_t events(SiblingScanPath path) const {
    return events_[static_cast<uint8_t>(path)];
  }

  uint64_t totalSteps() const {
    uint64_t s = 0;
    for (uint8_t i = 0; i < static_cast<uint8_t>(SiblingScanPath::Count); ++i) s += steps_[i];
    return s;
  }

 private:
  uint64_t steps_[static_cast<uint8_t>(SiblingScanPath::Count)]{};
  uint64_t events_[static_cast<uint8_t>(SiblingScanPath::Count)]{};
};

}  // namespace speculum::producer
