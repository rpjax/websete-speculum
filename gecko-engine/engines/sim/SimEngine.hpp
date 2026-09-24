#pragma once

#include <cassert>
#include <cstdint>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "domain/Result.hpp"
#include "domain/Types.hpp"
#include "domain/documents/Documents.hpp"
#include "domain/documents/Hosts.hpp"
#include "domain/documents/NavigationState.hpp"
#include "domain/documents/Viewports.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/ids/Ids.hpp"
#include "domain/session/Correlations.hpp"
#include "engines/sim/SimDocument.hpp"
#include "engines/sim/SimProcess.hpp"
#include "domain/producer/Producer.hpp"
#include "ports/IClock.hpp"
#include "ports/IEngine.hpp"
#include "ports/IEngineHost.hpp"
#include "ports/IEngineObserver.hpp"
#include "ports/IHostObserver.hpp"
#include "ports/IPatchUplink.hpp"

namespace speculum::sim {

// Effect log for acceptance A1.
enum class EffectKind : uint8_t {
  NavRequested,
  NavCancelled,
  DocDiscarded,
  DocInstalled,
  Load,
  Location,
  HostDetached,
  ProcessGone,
};

struct Effect {
  EffectKind kind{};
  HostId host{};
  DocumentId doc{};
  ProcessId process{};
  CorrelationId correlation{0};
  bool ok{true};
  std::string detail;
};

class EffectLog {
 public:
  void push(Effect e) { items_.push_back(std::move(e)); }
  const std::vector<Effect>& items() const { return items_; }
  void clear() { items_.clear(); }
  bool operator==(const EffectLog& o) const {
    if (items_.size() != o.items_.size()) return false;
    for (size_t i = 0; i < items_.size(); ++i) {
      const auto& a = items_[i];
      const auto& b = o.items_[i];
      if (a.kind != b.kind || a.host != b.host || a.doc != b.doc ||
          a.process != b.process || a.correlation != b.correlation || a.ok != b.ok ||
          a.detail != b.detail)
        return false;
    }
    return true;
  }

 private:
  std::vector<Effect> items_;
};

class SimEngine;

class SimHost final : public IEngineHost {
 public:
  SimHost(SimEngine& engine, HostId id) : engine_(engine), id_(id) {}

  HostId id() const override { return id_; }
  Result<void> navigate(std::string_view url) override;
  Result<void> reload(bool bypassCache) override;
  Result<void> stop() override;
  Result<void> historyGo(int32_t delta) override;
  Result<void> resize(Extent extent) override;
  const IEngineDocument* document() const override;
  void attach(IHostObserver* obs) override { observer_ = obs; }
  IHostObserver* observer() const { return observer_; }

 private:
  SimEngine& engine_;
  HostId id_;
  IHostObserver* observer_{nullptr};
};

class SimEngine final : public IEngine {
 public:
  SimEngine() : viewports_(hosts_) {}

  Hosts& hosts() { return hosts_; }
  Documents& documents() { return documents_; }
  Viewports& viewports() { return viewports_; }
  session::Correlations& correlations() { return correlations_; }
  EffectLog& effects() { return effects_; }
  HostMinter& hostMinter() { return host_minter_; }

  Result<ViewportId> openViewport(Extent extent, HostId* outRoot) override {
    HostId root = host_minter_.mint();
    ViewportId vid = viewports_.open(extent, root);
    HostNode node;
    node.id = root;
    node.parent = {};
    node.viewport = vid;
    node.extent = extent;
    hosts_.attach(node);
    hosts_by_id_[root.value()] = std::make_unique<SimHost>(*this, root);
    if (outRoot) *outRoot = root;
    return Result<ViewportId>::success(vid);
  }

  Result<void> closeViewport(ViewportId id) override {
    auto* rec = viewports_.find(id);
    if (!rec) {
      return Result<void>::failure(fault::makeFault(fault::FaultCode::NoSuchViewport,
                                                 "SimEngine", "closeViewport"));
    }
    auto detached = viewports_.close(id);
    for (auto hid : detached) {
      discardHostLocal(hid);
      effects_.push({EffectKind::HostDetached, hid, {}, {}, 0, true, {}});
    }
    return Result<void>::success();
  }

  IEngineHost* frame(HostId id) override {
    auto it = hosts_by_id_.find(id.value());
    return it == hosts_by_id_.end() ? nullptr : it->second.get();
  }

  IEngineProcess* process(ProcessId id) override {
    auto it = processes_.find(id.value());
    return it == processes_.end() ? nullptr : it->second.get();
  }

  void attach(IEngineObserver* obs) override { observer_ = obs; }

  // Phase 4: wire producer deps (clock + uplink). When set, each new document gets a Producer.
  void setProducerDeps(IClock* clock, IPatchUplink* uplink) {
    prod_clock_ = clock;
    prod_uplink_ = uplink;
  }

  producer::Producer* producerOf(DocumentId id) {
    auto it = producers_.find(key(id));
    return it == producers_.end() ? nullptr : it->second.get();
  }

  // --- sim test API ---

  HostId attachChildHost(HostId parent, Extent extent) {
    auto* p = hosts_.find(parent);
    assert(p);
    HostId id = host_minter_.mint();
    HostNode node;
    node.id = id;
    node.parent = parent;
    node.viewport = p->viewport;
    node.extent = extent;
    hosts_.attach(node);
    hosts_by_id_[id.value()] = std::make_unique<SimHost>(*this, id);
    return id;
  }

  ProcessId createProcess() {
    ProcessId id = process_minter_.mint();
    processes_[id.value()] = std::make_unique<SimProcess>(id);
    return id;
  }

  // Navigate orchestration (called from SimHost).
  Result<void> doNavigate(HostId host, std::string_view url,
                          CorrelationId corr = 0) {
    auto* node = hosts_.find(host);
    if (!node) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "SimEngine", "navigate"));
    }
    if (url.empty()) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::MalformedUrl, "SimEngine", "empty url"));
    }

    NavApplyResult nav = node->nav.apply(NavEvent{NavEventKind::Requested, corr});
    effects_.push({EffectKind::NavRequested, host, {}, {}, corr, true, std::string(url)});
    if (nav.effect == NavEffect::Cancelled) {
      effects_.push(
          {EffectKind::NavCancelled, host, {}, {}, nav.cancelled, true, {}});
      if (nav.cancelled != 0) correlations_.take(nav.cancelled);
    }
    if (corr != 0) {
      correlations_.remember(corr, session::PendingKind::Navigate, host,
                             Generation{node->generation.value + 1});
    }

    // Discard previous document if any.
    if (node->generation.value != 0) {
      DocumentId old{host, node->generation};
      discardDocumentAt(old, /*fromNavigate=*/true);
    }

    // Install new generation + document on default process for host (create if needed).
    Generation gen{node->generation.value + 1};
    hosts_.installDocument(host, gen);
    DocumentId did{host, gen};

    ProcessId pid = processForHost(host);
    auto doc = std::make_unique<SimDocument>(did);
    SimDocument* raw = doc.get();
    docs_[key(did)] = std::move(doc);
    documents_.install(did, pid);
    processes_[pid.value()]->addDocument(raw);
    host_process_[host.value()] = pid;

    if (prod_clock_ && prod_uplink_) {
      auto prod = std::make_unique<producer::Producer>(did, raw->view(), *prod_clock_,
                                                       *prod_uplink_);
      raw->attach(prod.get());
      prod->establish(raw->view().root());
      producers_[key(did)] = std::move(prod);
    }

    effects_.push({EffectKind::DocInstalled, host, did, pid, corr, true, {}});
    if (auto* h = static_cast<SimHost*>(frame(host))) {
      if (h->observer()) h->observer()->onDocumentInstalled(*raw);
    }
    pending_url_[host.value()] = std::string(url);
    return Result<void>::success();
  }

  // Emit load/location from sim script (feeds NavigationState + observers).
  void emitLoadStarted(HostId host) {
    auto* node = hosts_.find(host);
    assert(node);
    node->nav.apply(NavEvent{NavEventKind::LoadStarted, 0});
  }

  void emitLocation(HostId host, std::string_view url, bool replace = false) {
    auto* node = hosts_.find(host);
    assert(node);
    node->nav.apply(NavEvent{NavEventKind::LocationChanged, 0});
    effects_.push({EffectKind::Location, host, {}, {}, 0, true, std::string(url)});
    if (auto* h = static_cast<SimHost*>(frame(host))) {
      if (h->observer()) h->observer()->onLocation(url, replace);
    }
  }

  void emitLoadStopped(HostId host, bool ok, uint32_t httpStatus = 200) {
    auto* node = hosts_.find(host);
    assert(node);
    auto kind = ok ? NavEventKind::LoadStoppedOk : NavEventKind::LoadStoppedFail;
    auto r = node->nav.apply(NavEvent{kind, 0});
    (void)r;
    effects_.push({EffectKind::Load, host, {}, {}, 0, ok, {}});
    if (auto* h = static_cast<SimHost*>(frame(host))) {
      if (h->observer()) h->observer()->onLoad(ok, httpStatus);
    }
    // Complete navigate correlation if any.
    auto corr = node->nav.activeCorrelation();
    if (corr != 0 &&
        (node->nav.phase() == NavPhase::Committed || node->nav.phase() == NavPhase::Failed)) {
      correlations_.take(corr);
    }
  }

  void killProcess(ProcessId pid) {
    auto it = processes_.find(pid.value());
    if (it == processes_.end()) return;
    SimProcess* proc = it->second.get();

    auto discarded = documents_.discardAllOfProcess(pid);
    std::set<uint32_t> host_set;
    for (auto did : discarded) {
      effects_.push({EffectKind::DocDiscarded, did.host, did, pid, 0, true, {}});
      if (auto* h = static_cast<SimHost*>(frame(did.host))) {
        if (h->observer()) h->observer()->onDocumentDiscarded(did);
      }
      auto dit = docs_.find(key(did));
      if (dit != docs_.end()) docs_.erase(dit);
      producers_.erase(key(did));
      host_set.insert(did.host.value());
      if (auto* n = hosts_.find(did.host)) {
        if (n->generation == did.generation) hosts_.discardDocument(did.host);
      }
    }

    std::vector<HostId> roots;
    for (uint32_t hv : host_set) {
      HostId h{hv};
      const auto* n = hosts_.find(h);
      if (!n) continue;
      bool parentAlso = n->parent.valid() && host_set.count(n->parent.value()) != 0;
      if (!parentAlso) roots.push_back(h);
    }
    for (auto root : roots) {
      if (!hosts_.find(root)) continue;
      // Drop leftover docs on subtree hosts (other processes) before detach.
      std::vector<HostId> subtree;
      hosts_.forEachInSubtree(root, [&](HostId h) { subtree.push_back(h); });
      for (auto hid : subtree) {
        auto* n = hosts_.find(hid);
        if (!n || n->generation.value == 0) continue;
        DocumentId did{hid, n->generation};
        if (!documents_.find(did)) continue;
        // Silent hygiene — not part of the killed-process discard set.
        if (auto* rec = documents_.find(did)) {
          if (auto* op = process(rec->process))
            static_cast<SimProcess*>(op)->removeDocument(did);
          documents_.discard(did);
        }
        docs_.erase(key(did));
        producers_.erase(key(did));
        hosts_.discardDocument(hid);
      }
      ViewportId vid = hosts_.find(root)->viewport;
      bool isViewportRoot = !hosts_.find(root)->parent.valid();
      auto gone = hosts_.detach(root);
      for (auto hid : gone) {
        discardHostLocal(hid);
        effects_.push({EffectKind::HostDetached, hid, {}, {}, 0, true, {}});
      }
      if (isViewportRoot) viewports_.forget(vid);
    }

    effects_.push({EffectKind::ProcessGone, {}, {}, pid, 0, true, {}});
    if (observer_) observer_->onProcessGone(*proc);
    processes_.erase(it);
  }

  bool checkInvariants() const {
    if (!hosts_.checkInvariants()) return false;
    if (!viewports_.checkInvariants()) return false;
    return documents_.checkInvariants(
        [&](HostId h) { return hosts_.find(h) != nullptr; },
        [&](ProcessId p) { return processes_.find(p.value()) != processes_.end(); });
  }

  const IEngineDocument* documentOf(HostId host) const {
    const auto* n = hosts_.find(host);
    if (!n || n->generation.value == 0) return nullptr;
    DocumentId did{host, n->generation};
    auto it = docs_.find(key(did));
    return it == docs_.end() ? nullptr : it->second.get();
  }

  // Apply wire Resync force — motor does not choose policy.
  Result<void> doResync(HostId host, producer::ResyncForce force) {
    auto* n = hosts_.find(host);
    if (!n || n->generation.value == 0) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchDocument, "SimEngine", "resync"));
    }
    DocumentId did{host, n->generation};
    auto* prod = producerOf(did);
    if (!prod) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchDocument, "SimEngine", "no producer"));
    }
    auto* doc = simDocumentOf(host);
    if (!doc) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchDocument, "SimEngine", "no doc"));
    }
    return prod->resync(force, doc->view().root());
  }

  SimDocument* simDocumentOf(HostId host) {
    return const_cast<SimDocument*>(
        static_cast<const SimDocument*>(documentOf(host)));
  }

  Result<void> doResize(HostId host, Extent extent) {
    auto* n = hosts_.find(host);
    if (!n) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "SimEngine", "resize"));
    }
    n->extent = extent;
    return Result<void>::success();
  }

  Result<void> doReload(HostId host, bool) {
    auto* n = hosts_.find(host);
    if (!n) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "SimEngine", "reload"));
    }
    auto it = pending_url_.find(host.value());
    std::string url = it != pending_url_.end() ? it->second : "about:blank";
    return doNavigate(host, url, 0);
  }

  Result<void> doStop(HostId host) {
    auto* n = hosts_.find(host);
    if (!n) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "SimEngine", "stop"));
    }
    // loadStopped while Requested = None (table).
    n->nav.apply(NavEvent{NavEventKind::LoadStoppedOk, 0});
    return Result<void>::success();
  }

  Result<void> doHistoryGo(HostId host, int32_t) {
    auto* n = hosts_.find(host);
    if (!n) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "SimEngine", "historyGo"));
    }
    return Result<void>::success();
  }

  // Test/sim API: detach a non-root host without killing its process.
  void detachHost(HostId hid) {
    auto* n = hosts_.find(hid);
    if (!n) return;
    if (!n->parent.valid()) return;  // viewport roots use closeViewport
    if (n->generation.value != 0) {
      DocumentId did{hid, n->generation};
      discardDocumentAt(did, false);
      hosts_.discardDocument(hid);
    }
    auto gone = hosts_.detach(hid);
    for (auto h : gone) {
      discardHostLocal(h);
      effects_.push({EffectKind::HostDetached, h, {}, {}, 0, true, {}});
    }
  }

  // Test/sim API: move document ownership to dest process (same DocumentId).
  void bindDocumentToProcess(HostId host, ProcessId dest) {
    auto* d = documentOf(host);
    assert(d);
    DocumentId id = d->id();
    auto* rec = documents_.find(id);
    assert(rec);
    ProcessId old = rec->process;
    if (old == dest) return;
    if (auto* op = process(old)) static_cast<SimProcess*>(op)->removeDocument(id);
    documents_.discard(id);
    documents_.install(id, dest);
    auto* raw = docs_[key(id)].get();
    static_cast<SimProcess*>(process(dest))->addDocument(raw);
    host_process_[host.value()] = dest;
  }

 private:
  static uint64_t key(DocumentId id) {
    return (uint64_t(id.host.value()) << 32) | id.generation.value;
  }

  ProcessId processForHost(HostId host) {
    auto it = host_process_.find(host.value());
    if (it != host_process_.end() && processes_.count(it->second.value()))
      return it->second;
    return createProcess();
  }

  void discardDocumentAt(DocumentId did, bool /*fromNavigate*/) {
    effects_.push({EffectKind::DocDiscarded, did.host, did, {}, 0, true, {}});
    if (auto* h = static_cast<SimHost*>(frame(did.host))) {
      if (h->observer()) h->observer()->onDocumentDiscarded(did);
    }
    if (auto* rec = documents_.find(did)) {
      ProcessId p = rec->process;
      if (auto* proc = process(p)) {
        static_cast<SimProcess*>(proc)->removeDocument(did);
      }
      documents_.discard(did);
    }
    docs_.erase(key(did));
    producers_.erase(key(did));
  }

  void discardHostLocal(HostId hid) {
    // Drop docs for this host if still present.
    if (auto* n = hosts_.find(hid)) {
      if (n->generation.value != 0) {
        DocumentId did{hid, n->generation};
        if (documents_.find(did)) {
          // Already handled in kill path usually.
        }
      }
    }
    hosts_by_id_.erase(hid.value());
    host_process_.erase(hid.value());
    pending_url_.erase(hid.value());
  }

  Hosts hosts_;
  Documents documents_;
  Viewports viewports_;
  session::Correlations correlations_;
  EffectLog effects_;
  HostMinter host_minter_;
  ProcessMinter process_minter_;
  IEngineObserver* observer_{nullptr};

  std::unordered_map<uint32_t, std::unique_ptr<SimHost>> hosts_by_id_;
  std::unordered_map<uint32_t, std::unique_ptr<SimProcess>> processes_;
  std::unordered_map<uint64_t, std::unique_ptr<SimDocument>> docs_;
  std::unordered_map<uint64_t, std::unique_ptr<producer::Producer>> producers_;
  std::unordered_map<uint32_t, ProcessId> host_process_;
  std::unordered_map<uint32_t, std::string> pending_url_;
  IClock* prod_clock_{nullptr};
  IPatchUplink* prod_uplink_{nullptr};
};

inline Result<void> SimHost::navigate(std::string_view url) {
  return engine_.doNavigate(id_, url, 0);
}
inline Result<void> SimHost::reload(bool bypassCache) {
  return engine_.doReload(id_, bypassCache);
}
inline Result<void> SimHost::stop() { return engine_.doStop(id_); }
inline Result<void> SimHost::historyGo(int32_t delta) {
  return engine_.doHistoryGo(id_, delta);
}
inline Result<void> SimHost::resize(Extent extent) {
  return engine_.doResize(id_, extent);
}
inline const IEngineDocument* SimHost::document() const {
  return engine_.documentOf(id_);
}

}  // namespace speculum::sim
