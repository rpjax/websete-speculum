#pragma once

#include <cstdint>
#include <span>
#include <vector>

#include "domain/wire/Cursor.hpp"
#include "domain/wire/Envelope.hpp"
#include "domain/wire/gen/SpeculumWire.gen.hpp"

namespace speculum::session {

// Owners receive one call per inbound opcode. Phase 2: record; product fills later.
struct ISessionCommands {
  virtual ~ISessionCommands() = default;
  virtual void onFreezeAll(const wire::FreezeAll&) = 0;
  virtual void onCaptureState(const wire::CaptureState&) = 0;
  virtual void onThawAll(const wire::ThawAll&) = 0;
  virtual void onProbe(const wire::Probe&) = 0;
  virtual void onShutdown(const wire::Shutdown&) = 0;
  virtual void onViewportOpen(const wire::ViewportOpen&) = 0;
};

struct IViewportCommands {
  virtual ~IViewportCommands() = default;
  virtual void onViewportClose(const wire::ViewportClose&) = 0;
  virtual void onViewportResize(const wire::ViewportResize&) = 0;
};

struct IHostCommands {
  virtual ~IHostCommands() = default;
  virtual void onNavigate(const wire::Navigate&) = 0;
  virtual void onReload(const wire::Reload&) = 0;
  virtual void onStopLoad(const wire::StopLoad&) = 0;
  virtual void onHistoryGo(const wire::HistoryGo&) = 0;
  virtual void onHostResize(const wire::HostResize&) = 0;
  virtual void onResync(const wire::Resync&) = 0;
  virtual void onClocksHalt(const wire::ClocksHalt&) = 0;
  virtual void onClocksResume(const wire::ClocksResume&) = 0;
  virtual void onPromptRespond(const wire::PromptRespond&) = 0;
  virtual void onFlush(const wire::Flush&) = 0;
  virtual void onSnapshot(const wire::Snapshot&) = 0;
  virtual void onInputPointerDown(const wire::InputPointerDown&) = 0;
  virtual void onInputPointerUp(const wire::InputPointerUp&) = 0;
  virtual void onInputKeyDown(const wire::InputKeyDown&) = 0;
  virtual void onInputKeyUp(const wire::InputKeyUp&) = 0;
  virtual void onInputScroll(const wire::InputScroll&) = 0;
  virtual void onAssetRequest(const wire::AssetRequest&) = 0;
  virtual void onAssetCancel(const wire::AssetCancel&) = 0;
};

struct RouterStats {
  int unknown_opcodes{0};
  int wrong_direction{0};
  std::vector<uint16_t> routed;
};

class Router {
 public:
  Router(ISessionCommands& session, IViewportCommands& viewport, IHostCommands& host)
      : session_(session), viewport_(viewport), host_(host) {}

  void onEnvelope(const wire::Envelope& env, std::span<const uint8_t> payload) {
    if (env.opcode & 0x8000) {
      ++stats_.wrong_direction;
      return;
    }
    wire::Reader r(payload);
    switch (env.opcode) {
      case wire::FreezeAll::kOpcode: {
        wire::FreezeAll m{};
        if (!wire::decode_FreezeAll(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        session_.onFreezeAll(m);
        return;
      }
      case wire::CaptureState::kOpcode: {
        wire::CaptureState m{};
        if (!wire::decode_CaptureState(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        session_.onCaptureState(m);
        return;
      }
      case wire::ThawAll::kOpcode: {
        wire::ThawAll m{};
        if (!wire::decode_ThawAll(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        session_.onThawAll(m);
        return;
      }
      case wire::Probe::kOpcode: {
        wire::Probe m{};
        if (!wire::decode_Probe(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        session_.onProbe(m);
        return;
      }
      case wire::Shutdown::kOpcode: {
        wire::Shutdown m{};
        if (!wire::decode_Shutdown(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        session_.onShutdown(m);
        return;
      }
      case wire::ViewportOpen::kOpcode: {
        wire::ViewportOpen m{};
        if (!wire::decode_ViewportOpen(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        session_.onViewportOpen(m);
        return;
      }
      case wire::ViewportClose::kOpcode: {
        wire::ViewportClose m{};
        if (!wire::decode_ViewportClose(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        viewport_.onViewportClose(m);
        return;
      }
      case wire::ViewportResize::kOpcode: {
        wire::ViewportResize m{};
        if (!wire::decode_ViewportResize(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        viewport_.onViewportResize(m);
        return;
      }
      case wire::Navigate::kOpcode: {
        wire::Navigate m{};
        if (!wire::decode_Navigate(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onNavigate(m);
        return;
      }
      case wire::Reload::kOpcode: {
        wire::Reload m{};
        if (!wire::decode_Reload(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onReload(m);
        return;
      }
      case wire::StopLoad::kOpcode: {
        wire::StopLoad m{};
        if (!wire::decode_StopLoad(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onStopLoad(m);
        return;
      }
      case wire::HistoryGo::kOpcode: {
        wire::HistoryGo m{};
        if (!wire::decode_HistoryGo(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onHistoryGo(m);
        return;
      }
      case wire::HostResize::kOpcode: {
        wire::HostResize m{};
        if (!wire::decode_HostResize(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onHostResize(m);
        return;
      }
      case wire::Resync::kOpcode: {
        wire::Resync m{};
        if (!wire::decode_Resync(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onResync(m);
        return;
      }
      case wire::ClocksHalt::kOpcode: {
        wire::ClocksHalt m{};
        if (!wire::decode_ClocksHalt(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onClocksHalt(m);
        return;
      }
      case wire::ClocksResume::kOpcode: {
        wire::ClocksResume m{};
        if (!wire::decode_ClocksResume(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onClocksResume(m);
        return;
      }
      case wire::PromptRespond::kOpcode: {
        wire::PromptRespond m{};
        if (!wire::decode_PromptRespond(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onPromptRespond(m);
        return;
      }
      case wire::Flush::kOpcode: {
        wire::Flush m{};
        if (!wire::decode_Flush(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onFlush(m);
        return;
      }
      case wire::Snapshot::kOpcode: {
        wire::Snapshot m{};
        if (!wire::decode_Snapshot(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onSnapshot(m);
        return;
      }
      case wire::InputPointerDown::kOpcode: {
        wire::InputPointerDown m{};
        if (!wire::decode_InputPointerDown(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onInputPointerDown(m);
        return;
      }
      case wire::InputPointerUp::kOpcode: {
        wire::InputPointerUp m{};
        if (!wire::decode_InputPointerUp(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onInputPointerUp(m);
        return;
      }
      case wire::InputKeyDown::kOpcode: {
        wire::InputKeyDown m{};
        if (!wire::decode_InputKeyDown(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onInputKeyDown(m);
        return;
      }
      case wire::InputKeyUp::kOpcode: {
        wire::InputKeyUp m{};
        if (!wire::decode_InputKeyUp(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onInputKeyUp(m);
        return;
      }
      case wire::InputScroll::kOpcode: {
        wire::InputScroll m{};
        if (!wire::decode_InputScroll(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onInputScroll(m);
        return;
      }
      case wire::AssetRequest::kOpcode: {
        wire::AssetRequest m{};
        if (!wire::decode_AssetRequest(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onAssetRequest(m);
        return;
      }
      case wire::AssetCancel::kOpcode: {
        wire::AssetCancel m{};
        if (!wire::decode_AssetCancel(r, m) || !r.ok()) return;
        stats_.routed.push_back(env.opcode);
        host_.onAssetCancel(m);
        return;
      }
      default:
        ++stats_.unknown_opcodes;
        return;
    }
  }

  const RouterStats& stats() const { return stats_; }

  // All inbound opcodes from schema — completeness oracle.
  static constexpr uint16_t kInboundOpcodes[] = {
      wire::FreezeAll::kOpcode,      wire::CaptureState::kOpcode,
      wire::ThawAll::kOpcode,        wire::Probe::kOpcode,
      wire::Shutdown::kOpcode,       wire::ViewportOpen::kOpcode,
      wire::ViewportClose::kOpcode,  wire::ViewportResize::kOpcode,
      wire::Navigate::kOpcode,       wire::Reload::kOpcode,
      wire::StopLoad::kOpcode,       wire::HistoryGo::kOpcode,
      wire::HostResize::kOpcode,     wire::Resync::kOpcode,
      wire::ClocksHalt::kOpcode,     wire::ClocksResume::kOpcode,
      wire::PromptRespond::kOpcode,  wire::Flush::kOpcode,
      wire::Snapshot::kOpcode,       wire::InputPointerDown::kOpcode,
      wire::InputPointerUp::kOpcode, wire::InputKeyDown::kOpcode,
      wire::InputKeyUp::kOpcode,     wire::InputScroll::kOpcode,
      wire::AssetRequest::kOpcode,   wire::AssetCancel::kOpcode,
  };
  static constexpr std::size_t kInboundCount =
      sizeof(kInboundOpcodes) / sizeof(kInboundOpcodes[0]);

 private:
  ISessionCommands& session_;
  IViewportCommands& viewport_;
  IHostCommands& host_;
  RouterStats stats_;
};

}  // namespace speculum::session
