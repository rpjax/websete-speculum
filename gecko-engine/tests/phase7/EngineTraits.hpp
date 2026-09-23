#pragma once

// Test-layer only. Concrete engines + Traits must not appear in domain/session
// or domain/producer (02-camadas grep).

#include "domain/roteiro/Runner.hpp"
#include "domain/roteiro/SpecDriver.hpp"
#include "engines/gecko/GeckoEngine.hpp"
#include "engines/gecko/GeckoStateCapture.hpp"
#include "engines/gecko/GeckoStateFreezer.hpp"
#include "engines/sim/SimEngine.hpp"
#include "engines/sim/SimStateCapture.hpp"
#include "engines/sim/SimStateFreezer.hpp"

namespace speculum::roteiro {

struct SimEngineTraits {
  using Engine = sim::SimEngine;
  using Document = sim::SimDocument;
  using Freezer = sim::SimStateFreezer;
  using Capture = sim::SimStateCapture;
  static Document* documentOf(Engine& e, HostId h) { return e.simDocumentOf(h); }
  static Hosts& hosts(Engine& e) { return e.hosts(); }
};

struct GeckoEngineTraits {
  using Engine = gecko::GeckoEngine;
  using Document = gecko::GeckoDocument;
  using Freezer = gecko::GeckoStateFreezer;
  using Capture = gecko::GeckoStateCapture;
  static Document* documentOf(Engine& e, HostId h) { return e.geckoDocumentOf(h); }
  static Hosts& hosts(Engine& e) { return e.hosts(); }
};

using SpecDriver = SpecDriverT<SimEngineTraits>;
using GeckoSpecDriver = SpecDriverT<GeckoEngineTraits>;
using Runner = RunnerT<SimEngineTraits>;

}  // namespace speculum::roteiro
