#pragma once

#include <cassert>
#include <cstdint>
#include <optional>

#include "domain/ids/Ids.hpp"

namespace speculum {

enum class NavPhase : uint8_t { Idle, Requested, Started, Committed, Failed };
enum class NavEffect : uint8_t {
  None,
  EmitLoadStart,
  EmitNavigated,
  EmitFailed,
  Cancelled
};

enum class NavEventKind : uint8_t {
  Requested,
  LoadStarted,
  LoadStoppedOk,
  LoadStoppedFail,
  LocationChanged,
};

struct NavEvent {
  NavEventKind kind{};
  CorrelationId correlation{0};  // for Requested / Cancelled exposure
};

struct NavApplyResult {
  NavEffect effect{NavEffect::None};
  CorrelationId cancelled{0};  // set when effect == Cancelled
};

// Single illegal-transition handler (A5).
inline void (*g_navIllegalHook)(NavPhase, NavEventKind) = nullptr;

inline void navIllegalTransition(NavPhase phase, NavEventKind ev) {
  if (g_navIllegalHook) {
    g_navIllegalHook(phase, ev);
    return;
  }
  assert(false && "NavigationState: transition not in table");
  (void)phase;
  (void)ev;
}

class NavigationState {
 public:
  NavPhase phase() const { return phase_; }
  CorrelationId activeCorrelation() const { return active_; }

  NavApplyResult apply(NavEvent ev) {
    // Row: any + requested → Requested, Cancelled (except Idle → None).
    if (ev.kind == NavEventKind::Requested) {
      NavApplyResult r;
      if (phase_ == NavPhase::Idle) {
        phase_ = NavPhase::Requested;
        active_ = ev.correlation;
        r.effect = NavEffect::None;
        return r;
      }
      r.effect = NavEffect::Cancelled;
      r.cancelled = active_;
      phase_ = NavPhase::Requested;
      active_ = ev.correlation;
      return r;
    }

    switch (phase_) {
      case NavPhase::Idle:
        navIllegalTransition(phase_, ev.kind);
        return {};

      case NavPhase::Requested:
        if (ev.kind == NavEventKind::LoadStarted) {
          phase_ = NavPhase::Started;
          return {NavEffect::EmitLoadStart, 0};
        }
        if (ev.kind == NavEventKind::LoadStoppedOk ||
            ev.kind == NavEventKind::LoadStoppedFail) {
          // STOP of previous load — stay Requested, None.
          return {NavEffect::None, 0};
        }
        navIllegalTransition(phase_, ev.kind);
        return {};

      case NavPhase::Started:
        if (ev.kind == NavEventKind::LocationChanged) {
          return {NavEffect::None, 0};
        }
        if (ev.kind == NavEventKind::LoadStoppedOk) {
          phase_ = NavPhase::Committed;
          return {NavEffect::EmitNavigated, 0};
        }
        if (ev.kind == NavEventKind::LoadStoppedFail) {
          phase_ = NavPhase::Failed;
          return {NavEffect::EmitFailed, 0};
        }
        navIllegalTransition(phase_, ev.kind);
        return {};

      case NavPhase::Committed:
        if (ev.kind == NavEventKind::LoadStarted) {
          phase_ = NavPhase::Started;
          return {NavEffect::EmitLoadStart, 0};
        }
        navIllegalTransition(phase_, ev.kind);
        return {};

      case NavPhase::Failed:
        navIllegalTransition(phase_, ev.kind);
        return {};
    }
    navIllegalTransition(phase_, ev.kind);
    return {};
  }

 private:
  NavPhase phase_{NavPhase::Idle};
  CorrelationId active_{0};
};

}  // namespace speculum
