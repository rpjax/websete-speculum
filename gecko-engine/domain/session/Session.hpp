#pragma once

#include <cassert>
#include <cstdint>
#include <span>

#include "domain/fault/Fault.hpp"
#include "domain/session/Correlations.hpp"
#include "domain/session/DeathDump.hpp"
#include "domain/session/Heartbeat.hpp"
#include "domain/session/LinkWriter.hpp"
#include "domain/session/Router.hpp"
#include "domain/wire/Framer.hpp"
#include "ports/IClock.hpp"
#include "ports/ILink.hpp"

namespace speculum::session {

class Session final : public ILinkSink,
                      public wire::IEnvelopeTarget,
                      public IEmitGate,
                      public ISessionPhase {
 public:
  Session(ILink& link, IClock& clock, Router& router, Correlations& corr,
          IDeathDumpSink* dump, Millis heartbeatInterval)
      : link_(link),
        router_(router),
        corr_(corr),
        dump_(dump),
        writer_(link, *this),
        framer_(*this),
        heartbeat_(clock, writer_, *this, heartbeatInterval) {
    link_.attach(this);
  }

  Phase phase() const { return phase_; }
  bool mayEmit() const override { return phase_ == Phase::Ready; }
  bool isReady() const override { return phase_ == Phase::Ready; }

  LinkWriter& writer() { return writer_; }
  Correlations& correlations() { return corr_; }
  HeartbeatService& heartbeat() { return heartbeat_; }
  int envelopesRouted() const { return envelopes_routed_; }
  const fault::Fault& killer() const { return killer_; }
  bool hasKiller() const { return has_killer_; }
  int dumpCount() const { return dump_count_; }
  Phase phaseAtDump() const { return phase_at_dump_; }

  void onLinkEstablished() {
    transition(Phase::Booting, Phase::Linked);
  }

  void onHostReady() {
    transition(Phase::Linked, Phase::Ready);
    // Emit Ready outbound
    wire::Envelope env{};
    env.opcode = wire::Ready::kOpcode;
    writer_.offer(env, {});
    heartbeat_.start();
  }

  void onFault(const fault::Fault& f) {
    const auto action = fault::actionOf(f.code);
    if (action != fault::FaultAction::KillSession) return;
    kill(f);
  }

  // IEmitGate
  void onWriteBroken() override {
    onFault(fault::makeFault(fault::FaultCode::LinkBroken, "LinkWriter", "write broken"));
  }

  // ILinkSink
  void onBytes(std::span<const uint8_t> b) override {
    if (phase_ == Phase::Dead || phase_ == Phase::Terminating) return;
    framer_.feed(b);
  }

  void onWritable() override { writer_.onWritable(); }

  void onBroken() override {
    onFault(fault::makeFault(fault::FaultCode::LinkBroken, "ILink", "link broken"));
  }

  // IEnvelopeTarget
  void onEnvelope(const wire::Envelope& env, std::span<const uint8_t> payload) override {
    if (phase_ == Phase::Dead) return;
    ++envelopes_routed_;
    router_.onEnvelope(env, payload);
  }

  void onFramingLost(fault::Fault f) override { onFault(f); }

 private:
  void transition(Phase from, Phase to) {
    if (phase_ != from) {
      assert(false && "illegal session phase transition");
      return;
    }
    phase_ = to;
  }

  void kill(const fault::Fault& f) {
    if (phase_ == Phase::Dead) return;
    if (phase_ == Phase::Terminating) {
      // Already dying — ignore second cause
      return;
    }
    phase_ = Phase::Terminating;
    heartbeat_.stop();
    writer_.seal();
    if (!has_killer_) {
      killer_ = f;
      has_killer_ = true;
    }
    emitDump();
    phase_ = Phase::Dead;
  }

  void emitDump() {
    DeathDump d{};
    d.phase = phase_;  // Terminating
    d.has_killer = has_killer_;
    d.killer = killer_;
    d.correlations_pending = corr_.pending();
    d.correlations = corr_.items();
    d.writer_idle = writer_.isIdle();
    d.writer_pending_bytes = writer_.pendingBytes();
    phase_at_dump_ = phase_;
    ++dump_count_;
    if (dump_) dump_->onDeathDump(d);
  }

  ILink& link_;
  Router& router_;
  Correlations& corr_;
  IDeathDumpSink* dump_;
  LinkWriter writer_;
  wire::Framer framer_;
  HeartbeatService heartbeat_;
  Phase phase_{Phase::Booting};
  fault::Fault killer_{};
  bool has_killer_{false};
  int envelopes_routed_{0};
  int dump_count_{0};
  Phase phase_at_dump_{Phase::Booting};
};

}  // namespace speculum::session
