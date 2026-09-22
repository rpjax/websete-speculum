#pragma once

#include "domain/session/Router.hpp"
#include "domain/session/Session.hpp"
#include "domain/session/fakes/ManualClock.hpp"
#include "domain/session/fakes/ScriptedLink.hpp"
#include "engines/sim/EngineCommands.hpp"
#include "engines/sim/SimEngine.hpp"
#include "ports/IClock.hpp"
#include "ports/IEngine.hpp"
#include "ports/ILink.hpp"

namespace speculum {

// Composition root — all ports non-null, scopes coherent (04 §8.2).
class Composition {
 public:
  Composition()
      : commands_(engine_),
        router_(commands_, commands_, commands_),
        session_(link_, clock_, router_, engine_.correlations(), nullptr,
                 /*heartbeatMs*/ 30000) {}

  ILink& link() { return link_; }
  IClock& clock() { return clock_; }
  IEngine& engine() { return engine_; }
  sim::SimEngine& sim() { return engine_; }
  session::Session& session() { return session_; }
  session::Router& router() { return router_; }
  session::Correlations& correlations() { return engine_.correlations(); }
  sim::EngineCommands& commands() { return commands_; }

  bool portsNonNull() const { return true; }

  void onEnvelope(const wire::Envelope& env, std::span<const uint8_t> payload) {
    commands_.setEnvelopeMeta(env.target, env.correlation);
    router_.onEnvelope(env, payload);
  }

  void establish() {
    session_.onLinkEstablished();
    session_.onHostReady();
  }

 private:
  ScriptedLink link_;
  ManualClock clock_;
  sim::SimEngine engine_;
  sim::EngineCommands commands_;
  session::Router router_;
  session::Session session_;
};

}  // namespace speculum
