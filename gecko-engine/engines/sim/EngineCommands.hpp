#pragma once

#include "domain/session/Router.hpp"
#include "domain/wire/gen/SpeculumWire.gen.hpp"
#include "engines/sim/SimEngine.hpp"

namespace speculum::sim {

// Thin command bridge: Router → SimEngine. Target/correlation set per envelope.
class EngineCommands final : public session::ISessionCommands,
                             public session::IViewportCommands,
                             public session::IHostCommands {
 public:
  explicit EngineCommands(SimEngine& engine) : engine_(engine) {}

  void setEnvelopeMeta(uint32_t target, CorrelationId corr) {
    target_ = target;
    corr_ = corr;
  }

  void onFreezeAll(const wire::FreezeAll&) override {}
  void onCaptureState(const wire::CaptureState&) override {}
  void onThawAll(const wire::ThawAll&) override {}
  void onProbe(const wire::Probe&) override {}
  void onShutdown(const wire::Shutdown&) override {}

  void onViewportOpen(const wire::ViewportOpen& m) override {
    HostId root{};
    Extent e{m.extent.width, m.extent.height};
    engine_.openViewport(e, &root);
    (void)root;
  }

  void onViewportClose(const wire::ViewportClose&) override {
    engine_.closeViewport(ViewportId{target_});
  }

  void onViewportResize(const wire::ViewportResize& m) override {
    auto* rec = engine_.viewports().find(ViewportId{target_});
    if (!rec) return;
    if (auto* host = engine_.frame(rec->root)) {
      host->resize(Extent{m.extent.width, m.extent.height});
    }
  }

  void onNavigate(const wire::Navigate& m) override {
    engine_.doNavigate(HostId{target_}, m.url, corr_);
  }
  void onReload(const wire::Reload&) override {
    if (auto* h = engine_.frame(HostId{target_})) h->reload(false);
  }
  void onStopLoad(const wire::StopLoad&) override {
    if (auto* h = engine_.frame(HostId{target_})) h->stop();
  }
  void onHistoryGo(const wire::HistoryGo& m) override {
    if (auto* h = engine_.frame(HostId{target_})) h->historyGo(m.delta);
  }
  void onHostResize(const wire::HostResize& m) override {
    if (auto* h = engine_.frame(HostId{target_})) {
      h->resize(Extent{m.extent.width, m.extent.height});
    }
  }
  void onResync(const wire::Resync& m) override {
    // Apply force from the wire — never choose policy here (A2).
    auto force = m.force == wire::ResyncForce::FromMap ? producer::ResyncForce::FromMap
                                                       : producer::ResyncForce::FromWalk;
    (void)engine_.doResync(HostId{target_}, force);
  }
  void onClocksHalt(const wire::ClocksHalt&) override {}
  void onClocksResume(const wire::ClocksResume&) override {}
  void onPromptRespond(const wire::PromptRespond&) override {}
  void onFlush(const wire::Flush&) override {}
  void onSnapshot(const wire::Snapshot&) override {}
  void onInputPointerDown(const wire::InputPointerDown&) override {}
  void onInputPointerUp(const wire::InputPointerUp&) override {}
  void onInputKeyDown(const wire::InputKeyDown&) override {}
  void onInputKeyUp(const wire::InputKeyUp&) override {}
  void onInputScroll(const wire::InputScroll&) override {}
  void onAssetRequest(const wire::AssetRequest&) override {}
  void onAssetCancel(const wire::AssetCancel&) override {}

 private:
  SimEngine& engine_;
  uint32_t target_{0};
  CorrelationId corr_{0};
};

}  // namespace speculum::sim
