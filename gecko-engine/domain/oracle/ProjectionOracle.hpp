#pragma once

#include <string>
#include <unordered_map>
#include <unordered_set>

#include "domain/oracle/Capabilities.hpp"
#include "domain/oracle/Reconstructor.hpp"
#include "domain/oracle/Types.hpp"
#include "domain/producer/Policy.hpp"
#include "domain/producer/RowDescriptor.hpp"
#include "engines/sim/SimEngine.hpp"
#include "engines/sim/SimStateCapture.hpp"
#include "engines/sim/SimStateFreezer.hpp"
#include "ports/IProjectionOracle.hpp"

namespace speculum::oracle {

class ProjectionOracle final : public IProjectionOracle {
 public:
  ProjectionOracle(sim::SimEngine& eng, sim::SimStateFreezer& freezer,
                   sim::SimStateCapture& capture, Capabilities& caps)
      : eng_(eng), freezer_(freezer), capture_(capture), caps_(caps) {}

  void setRoteiroExcerpt(std::string excerpt) { excerpt_ = std::move(excerpt); }
  void setCauseSpan(SpanId span) { cause_span_ = span; }

  Verdict run(FreezeToken token) override {
    Verdict v;
    v.ok = true;
    if (!freezer_.isValid(token)) {
      v.ok = false;
      v.failedIn = Direction::None;
      v.roteiroExcerpt = "stale freeze token — no verdict";
      return v;
    }

    eng_.hosts().forEach([&](const HostNode& hn) {
      if (!v.ok) return;
      HostId host = hn.id;
      if (!eng_.simDocumentOf(host)) return;
      if (!eng_.producerOf(eng_.simDocumentOf(host)->id())) return;

      auto tableR = capture_.captureTable(token, host);
      auto liveR = capture_.captureLive(token, host);
      auto naiveR = capture_.captureNaive(token, host);
      if (!tableR.ok() || !liveR.ok() || !naiveR.ok()) {
        v.ok = false;
        v.host = host;
        v.roteiroExcerpt = "capture failed";
        return;
      }
      const auto& table = tableR.value();
      const auto& live = liveR.value();
      const auto& naive = naiveR.value();

      std::unordered_map<producer::NodeId, const ImageNode*> byTable;
      for (const auto& n : table.nodes) byTable[n.id] = &n;

      // --- IDA: d(VN) fresco × d(VTR) armazenado ---
      if (caps_.enabled(Cap::Forward)) {
        for (const auto& ln : live.nodes) {
          auto it = byTable.find(ln.id);
          if (it == byTable.end()) {
            fail(v, Direction::Forward, host, table, ln.id, "rowHash", ln.rowHash, 0);
            return;
          }
          const auto* stored = it->second;
          if (ln.rowHash != stored->rowHash) {
            // Prefer a specific field if one differs
            FieldId field = "rowHash";
            uint64_t exp = stored->rowHash;
            uint64_t act = ln.rowHash;
            for (const auto& [fname, fh] : ln.fieldHash) {
              auto sit = stored->fieldHash.find(fname);
              uint64_t sh = sit == stored->fieldHash.end() ? 0 : sit->second;
              if (fh != sh) {
                field = fname;
                exp = sh;
                act = fh;
                break;
              }
            }
            fail(v, Direction::Forward, host, table, ln.id, field, exp, act);
            return;
          }
        }
      }

      // --- VOLTA: reconstruct × naive + Policy → 3 buckets ---
      if (caps_.enabled(Cap::Reverse) || caps_.enabled(Cap::Ledger)) {
        Reconstructor recon;
        NaiveImage rebuilt = recon.reconstruct(table);
        std::unordered_set<producer::NodeId> inTable;
        for (const auto& n : rebuilt.nodes) inTable.insert(n.id);

        for (const auto& nn : naive.nodes) {
          if (inTable.count(nn.id)) continue;  // bucket 1: equal presence
          bool projectable = producer::Policy::isProjectable(nn.kind, nn.userAgentOwned);
          if (!projectable) {
            if (caps_.enabled(Cap::Ledger)) {
              ExclusionEntry e;
              e.id = nn.id;
              e.kind = nn.kind;
              e.name = nn.name;
              e.reason = nn.userAgentOwned ? "policy:userAgentOwned" : "policy:notProjectable";
              v.excluded.add(std::move(e));
            }
            continue;  // bucket 3
          }
          // bucket 2: defect
          if (caps_.enabled(Cap::Reverse)) {
            fail(v, Direction::Reverse, host, table, nn.id, "coverage", 1, 0);
            v.roteiroExcerpt = excerpt_.empty()
                                   ? ("projectable node absent from table: " + nn.name)
                                   : excerpt_;
            return;
          }
        }
      }
    });

    return v;
  }

 private:
  void fail(Verdict& v, Direction dir, HostId host, const TableImage& table,
            producer::NodeId row, FieldId field, uint64_t expected, uint64_t actual) {
    v.ok = false;
    v.failedIn = dir;
    v.host = host;
    v.generation = table.generation;
    v.sequence = table.sequence;
    v.row = row;
    v.field = std::move(field);
    v.expected = expected;
    v.actual = actual;
    v.causeSpan = cause_span_;
    if (!excerpt_.empty()) v.roteiroExcerpt = excerpt_;
  }

  sim::SimEngine& eng_;
  sim::SimStateFreezer& freezer_;
  sim::SimStateCapture& capture_;
  Capabilities& caps_;
  std::string excerpt_;
  SpanId cause_span_{0};
};

}  // namespace speculum::oracle
