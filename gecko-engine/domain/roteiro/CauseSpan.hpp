#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "domain/roteiro/Types.hpp"

namespace speculum::roteiro {

// Span of cause: each `>` opens a span; `<`/`@` inherit. Failure report uses span + `>` above.
class CauseSpan {
 public:
  void onLine(SpecLine& line) {
    if (line.kind == LineKind::In) {
      open_ = ++next_;
      line.spanId = open_;
      opens_.push_back({open_, line.lineNo, line.raw});
    } else if (line.kind == LineKind::Out || line.kind == LineKind::Time) {
      line.spanId = open_;
    }
  }

  void assignAll(std::vector<SpecLine>& lines) {
    open_ = 0;
    next_ = 0;
    opens_.clear();
    for (auto& l : lines) onLine(l);
  }

  struct Open {
    uint32_t id{0};
    int lineNo{0};
    std::string raw;
  };

  // Build report for first diverging output line.
  std::string report(int failLineNo, uint32_t spanId,
                     const std::vector<SpecLine>& lines) const {
    std::string msg = "diverge at line " + std::to_string(failLineNo) +
                      " span=" + std::to_string(spanId) + "\n";
    msg += "cause (inputs above):\n";
    for (const auto& l : lines) {
      if (l.lineNo >= failLineNo) break;
      if (l.kind == LineKind::In && (spanId == 0 || l.spanId == spanId ||
                                    l.spanId == spanId /* same open */)) {
        // Include all `>` with same span, and recent `>` generally
      }
      if (l.kind == LineKind::In && l.spanId == spanId) {
        msg += "  > " + l.raw + "\n";
      }
    }
    // Also include any `>` immediately above if span empty
    if (msg.find("  >") == std::string::npos) {
      for (int i = int(lines.size()) - 1; i >= 0; --i) {
        if (lines[i].lineNo >= failLineNo) continue;
        if (lines[i].kind == LineKind::In) {
          msg += "  > " + lines[i].raw + "\n";
          break;
        }
      }
    }
    return msg;
  }

  uint32_t current() const { return open_; }

 private:
  uint32_t next_{0};
  uint32_t open_{0};
  std::vector<Open> opens_;
};

}  // namespace speculum::roteiro
