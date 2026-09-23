#pragma once

#include <cassert>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>

#include "domain/Result.hpp"
#include "domain/Types.hpp"
#include "domain/documents/Documents.hpp"
#include "domain/documents/Hosts.hpp"
#include "domain/documents/NavigationState.hpp"
#include "domain/documents/Viewports.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/ids/Ids.hpp"
#include "domain/producer/Producer.hpp"
#include "domain/session/Correlations.hpp"
#include "engines/gecko/GeckoDocument.hpp"
#include "engines/gecko/GeckoProcess.hpp"
#include "ports/IClock.hpp"
#include "ports/IEngine.hpp"
#include "ports/IEngineHost.hpp"
#include "ports/IEngineObserver.hpp"
#include "ports/IHostObserver.hpp"
#include "ports/IPatchUplink.hpp"

namespace speculum::gecko {

class GeckoEngine;

class GeckoHost final : public IEngineHost {
 public:
  GeckoHost(GeckoEngine& eng, HostId id) : eng_(eng), id_(id) {}
  HostId id() const override { return id_; }
  Result<void> navigate(std::string_view url) override;
  Result<void> reload(bool) override;
  Result<void> stop() override;
  Result<void> historyGo(int32_t) override;
  Result<void> resize(Extent extent) override;
  const IEngineDocument* document() const override;
  void attach(IHostObserver* obs) override { observer_ = obs; }
  IHostObserver* observer() const { return observer_; }

 private:
  GeckoEngine& eng_;
  HostId id_;
  IHostObserver* observer_{nullptr};
};

// Host-buildable Gecko engine implementing the same ports as sim.
// nsI* wiring lives in GeckoXulGlue (SPECULUM_HAS_LIBXUL) — not in this TU.
class GeckoEngine final : public IEngine {
 public:
  GeckoEngine() : viewports_(hosts_) {}

  Hosts& hosts() { return hosts_; }
  Documents& documents() { return documents_; }
  Viewports& viewports() { return viewports_; }
  session::Correlations& correlations() { return correlations_; }

  Result<ViewportId> openViewport(Extent extent, HostId* outRoot) override {
    HostId root = host_minter_.mint();
    ViewportId vid = viewports_.open(extent, root);
    HostNode node;
    node.id = root;
    node.parent = {};
    node.viewport = vid;
    node.extent = extent;
    hosts_.attach(node);
    hosts_by_id_[root.value()] = std::make_unique<GeckoHost>(*this, root);
    if (outRoot) *outRoot = root;
    return Result<ViewportId>::success(vid);
  }

  Result<void> closeViewport(ViewportId id) override {
    auto* rec = viewports_.find(id);
    if (!rec) {
      return Result<void>::failure(fault::makeFault(fault::FaultCode::NoSuchViewport,
                                                    "GeckoEngine", "closeViewport"));
    }
    auto detached = viewports_.close(id);
    for (auto hid : detached) {
      auto* n = hosts_.find(hid);
      if (n && n->generation.value != 0) {
        discardDocumentAt(DocumentId{hid, n->generation});
        hosts_.discardDocument(hid);
      }
      discardHostLocal(hid);
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

  void setProducerDeps(IClock* clock, IPatchUplink* uplink) {
    prod_clock_ = clock;
    prod_uplink_ = uplink;
  }

  producer::Producer* producerOf(DocumentId id) {
    auto it = producers_.find(key(id));
    return it == producers_.end() ? nullptr : it->second.get();
  }

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
    hosts_by_id_[id.value()] = std::make_unique<GeckoHost>(*this, id);
    return id;
  }

  ProcessId createProcess() {
    ProcessId id = process_minter_.mint();
    processes_[id.value()] = std::make_unique<GeckoProcess>(id);
    return id;
  }

  // Site isolation (ITERACAO-06 A5): drop host→process binding so the next
  // navigate mints a new content process. Call before navigate while the old
  // process still owns the dying document's CssomTable.
  void releaseHostProcess(HostId host) { host_process_.erase(host.value()); }

  void killProcess(ProcessId pid) {
    for (auto it = host_process_.begin(); it != host_process_.end();) {
      if (it->second == pid)
        it = host_process_.erase(it);
      else
        ++it;
    }
    auto pit = processes_.find(pid.value());
    if (pit != processes_.end()) {
      pit->second->cssom().clear();
      processes_.erase(pit);
    }
  }

  Result<void> doNavigate(HostId host, std::string_view url, CorrelationId corr = 0) {
    auto* node = hosts_.find(host);
    if (!node) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "GeckoEngine", "navigate"));
    }
    if (url.empty()) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::MalformedUrl, "GeckoEngine", "empty url"));
    }
    node->nav.apply(NavEvent{NavEventKind::Requested, corr});
    if (node->generation.value != 0) {
      discardDocumentAt(DocumentId{host, node->generation});
    }
    Generation gen{node->generation.value + 1};
    hosts_.installDocument(host, gen);
    DocumentId did{host, gen};
    ProcessId pid = processForHost(host);
    auto* proc = static_cast<GeckoProcess*>(process(pid));
    auto doc = std::make_unique<GeckoDocument>(did, &proc->cssom());
    GeckoDocument* raw = doc.get();
    docs_[key(did)] = std::move(doc);
    documents_.install(did, pid);
    proc->addDocument(raw);
    host_process_[host.value()] = pid;

    if (prod_clock_ && prod_uplink_) {
      auto prod = std::make_unique<producer::Producer>(did, raw->view(), *prod_clock_,
                                                       *prod_uplink_);
      raw->attach(prod.get());
      prod->establish(raw->view().root());
      producers_[key(did)] = std::move(prod);
    }
    pending_url_[host.value()] = std::string(url);
    return Result<void>::success();
  }

  void emitLoadStarted(HostId host) {
    auto* node = hosts_.find(host);
    assert(node);
    node->nav.apply(NavEvent{NavEventKind::LoadStarted, 0});
  }

  void emitLoadStopped(HostId host, bool ok, uint32_t = 200) {
    auto* node = hosts_.find(host);
    assert(node);
    auto kind = ok ? NavEventKind::LoadStoppedOk : NavEventKind::LoadStoppedFail;
    node->nav.apply(NavEvent{kind, 0});
  }

  void detachHost(HostId hid) {
    auto* n = hosts_.find(hid);
    if (!n || !n->parent.valid()) return;
    if (n->generation.value != 0) {
      discardDocumentAt(DocumentId{hid, n->generation});
      hosts_.discardDocument(hid);
    }
    auto gone = hosts_.detach(hid);
    for (auto h : gone) discardHostLocal(h);
  }

  GeckoDocument* geckoDocumentOf(HostId host) {
    const auto* n = hosts_.find(host);
    if (!n || n->generation.value == 0) return nullptr;
    DocumentId did{host, n->generation};
    auto it = docs_.find(key(did));
    return it == docs_.end() ? nullptr : it->second.get();
  }

  const IEngineDocument* documentOf(HostId host) const {
    const auto* n = hosts_.find(host);
    if (!n || n->generation.value == 0) return nullptr;
    DocumentId did{host, n->generation};
    auto it = docs_.find(key(did));
    return it == docs_.end() ? nullptr : it->second.get();
  }

  Result<void> doResize(HostId host, Extent extent) {
    auto* n = hosts_.find(host);
    if (!n) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "GeckoEngine", "resize"));
    }
    n->extent = extent;
    return Result<void>::success();
  }

  Result<void> doReload(HostId host, bool) {
    auto it = pending_url_.find(host.value());
    std::string url = it != pending_url_.end() ? it->second : "about:blank";
    return doNavigate(host, url, 0);
  }

  Result<void> doStop(HostId host) {
    auto* n = hosts_.find(host);
    if (!n) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "GeckoEngine", "stop"));
    }
    n->nav.apply(NavEvent{NavEventKind::LoadStoppedOk, 0});
    return Result<void>::success();
  }

  Result<void> doHistoryGo(HostId host, int32_t) {
    auto* n = hosts_.find(host);
    if (!n) {
      return Result<void>::failure(
          fault::makeFault(fault::FaultCode::NoSuchHost, "GeckoEngine", "historyGo"));
    }
    return Result<void>::success();
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

  void discardDocumentAt(DocumentId did) {
    if (auto* rec = documents_.find(did)) {
      ProcessId p = rec->process;
      if (auto* proc = process(p)) {
        static_cast<GeckoProcess*>(proc)->removeDocument(did);
      }
      documents_.discard(did);
    }
    auto it = docs_.find(key(did));
    if (it != docs_.end()) {
      it->second->teardown();  // clears RawNodeMap — A1 leak contract
      docs_.erase(it);
    }
    producers_.erase(key(did));
  }

  void discardHostLocal(HostId hid) {
    hosts_by_id_.erase(hid.value());
    host_process_.erase(hid.value());
    pending_url_.erase(hid.value());
  }

  Hosts hosts_;
  Documents documents_;
  Viewports viewports_;
  session::Correlations correlations_;
  HostMinter host_minter_;
  ProcessMinter process_minter_;
  IEngineObserver* observer_{nullptr};
  std::unordered_map<uint32_t, std::unique_ptr<GeckoHost>> hosts_by_id_;
  std::unordered_map<uint32_t, std::unique_ptr<GeckoProcess>> processes_;
  std::unordered_map<uint64_t, std::unique_ptr<GeckoDocument>> docs_;
  std::unordered_map<uint64_t, std::unique_ptr<producer::Producer>> producers_;
  std::unordered_map<uint32_t, ProcessId> host_process_;
  std::unordered_map<uint32_t, std::string> pending_url_;
  IClock* prod_clock_{nullptr};
  IPatchUplink* prod_uplink_{nullptr};
};

inline Result<void> GeckoHost::navigate(std::string_view url) {
  return eng_.doNavigate(id_, url, 0);
}
inline Result<void> GeckoHost::reload(bool bypassCache) {
  return eng_.doReload(id_, bypassCache);
}
inline Result<void> GeckoHost::stop() { return eng_.doStop(id_); }
inline Result<void> GeckoHost::historyGo(int32_t delta) {
  return eng_.doHistoryGo(id_, delta);
}
inline Result<void> GeckoHost::resize(Extent extent) {
  return eng_.doResize(id_, extent);
}
inline const IEngineDocument* GeckoHost::document() const {
  return eng_.documentOf(id_);
}

}  // namespace speculum::gecko
