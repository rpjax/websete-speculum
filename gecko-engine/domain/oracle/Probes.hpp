#pragma once

#include "domain/fault/Fault.hpp"
#include "domain/oracle/Capabilities.hpp"

namespace speculum::oracle {

enum class ProbeId : uint16_t {
  HostTable = 1,
  PendingDirty = 6,
};

struct ProbeResult {
  bool enabled{false};
  fault::Fault fault{};
  uint64_t value{0};
};

// Sondas: never product path; disabled → ProbeDisabled (never silence).
class Probes {
 public:
  explicit Probes(Capabilities& caps) : caps_(caps) {}

  void setHostTableValue(uint64_t v) { host_table_ = v; }
  void setPendingDirty(uint64_t v) { pending_dirty_ = v; }

  ProbeResult probe(ProbeId id) const {
    ProbeResult r;
    // Probes require oracle.freeze or forward as "lab enabled" stand-in —
    // individual probe enable via same caps for simplicity: HostTable needs Forward.
    bool on = false;
    if (id == ProbeId::HostTable) on = caps_.enabled(Cap::Forward);
    if (id == ProbeId::PendingDirty) on = caps_.enabled(Cap::Shadow);
    if (!on) {
      r.enabled = false;
      r.fault = fault::makeFault(fault::FaultCode::ProbeDisabled, "Probes",
                                 "probe disabled");
      return r;
    }
    r.enabled = true;
    r.value = (id == ProbeId::HostTable) ? host_table_ : pending_dirty_;
    return r;
  }

 private:
  Capabilities& caps_;
  uint64_t host_table_{0};
  uint64_t pending_dirty_{0};
};

// Metrics live outside ISA deltas — on/off must not change patch bytes.
struct PatchMetrics {
  uint32_t buildMicros{0};
  uint32_t opCount{0};
  bool enabled{false};
};

}  // namespace speculum::oracle
