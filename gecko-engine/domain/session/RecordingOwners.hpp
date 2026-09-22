#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "domain/session/Router.hpp"

namespace speculum::session {

struct RecordingOwners : ISessionCommands, IViewportCommands, IHostCommands {
  std::vector<std::string> calls;
  std::vector<uint16_t> opcodes;

  void note(const char* name, uint16_t op) {
    calls.push_back(name);
    opcodes.push_back(op);
  }

  void onFreezeAll(const wire::FreezeAll&) override {
    note("session.FreezeAll", wire::FreezeAll::kOpcode);
  }
  void onCaptureState(const wire::CaptureState&) override {
    note("session.CaptureState", wire::CaptureState::kOpcode);
  }
  void onThawAll(const wire::ThawAll&) override {
    note("session.ThawAll", wire::ThawAll::kOpcode);
  }
  void onProbe(const wire::Probe&) override { note("session.Probe", wire::Probe::kOpcode); }
  void onShutdown(const wire::Shutdown&) override {
    note("session.Shutdown", wire::Shutdown::kOpcode);
  }
  void onViewportOpen(const wire::ViewportOpen&) override {
    note("session.ViewportOpen", wire::ViewportOpen::kOpcode);
  }

  void onViewportClose(const wire::ViewportClose&) override {
    note("viewport.ViewportClose", wire::ViewportClose::kOpcode);
  }
  void onViewportResize(const wire::ViewportResize&) override {
    note("viewport.ViewportResize", wire::ViewportResize::kOpcode);
  }

  void onNavigate(const wire::Navigate&) override {
    note("host.Navigate", wire::Navigate::kOpcode);
  }
  void onReload(const wire::Reload&) override { note("host.Reload", wire::Reload::kOpcode); }
  void onStopLoad(const wire::StopLoad&) override {
    note("host.StopLoad", wire::StopLoad::kOpcode);
  }
  void onHistoryGo(const wire::HistoryGo&) override {
    note("host.HistoryGo", wire::HistoryGo::kOpcode);
  }
  void onHostResize(const wire::HostResize&) override {
    note("host.HostResize", wire::HostResize::kOpcode);
  }
  void onResync(const wire::Resync&) override { note("host.Resync", wire::Resync::kOpcode); }
  void onClocksHalt(const wire::ClocksHalt&) override {
    note("host.ClocksHalt", wire::ClocksHalt::kOpcode);
  }
  void onClocksResume(const wire::ClocksResume&) override {
    note("host.ClocksResume", wire::ClocksResume::kOpcode);
  }
  void onPromptRespond(const wire::PromptRespond&) override {
    note("host.PromptRespond", wire::PromptRespond::kOpcode);
  }
  void onFlush(const wire::Flush&) override { note("host.Flush", wire::Flush::kOpcode); }
  void onSnapshot(const wire::Snapshot&) override {
    note("host.Snapshot", wire::Snapshot::kOpcode);
  }
  void onInputPointerDown(const wire::InputPointerDown&) override {
    note("host.InputPointerDown", wire::InputPointerDown::kOpcode);
  }
  void onInputPointerUp(const wire::InputPointerUp&) override {
    note("host.InputPointerUp", wire::InputPointerUp::kOpcode);
  }
  void onInputKeyDown(const wire::InputKeyDown&) override {
    note("host.InputKeyDown", wire::InputKeyDown::kOpcode);
  }
  void onInputKeyUp(const wire::InputKeyUp&) override {
    note("host.InputKeyUp", wire::InputKeyUp::kOpcode);
  }
  void onInputScroll(const wire::InputScroll&) override {
    note("host.InputScroll", wire::InputScroll::kOpcode);
  }
  void onAssetRequest(const wire::AssetRequest&) override {
    note("host.AssetRequest", wire::AssetRequest::kOpcode);
  }
  void onAssetCancel(const wire::AssetCancel&) override {
    note("host.AssetCancel", wire::AssetCancel::kOpcode);
  }
};

}  // namespace speculum::session
