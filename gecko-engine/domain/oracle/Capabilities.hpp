#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace speculum::oracle {

enum class Cap : uint8_t {
  Invariants = 0,
  Postcondition,
  Encode,
  Shadow,
  Freeze,
  Forward,
  Reverse,
  Ledger,
  Count
};

inline const char* capName(Cap c) {
  switch (c) {
    case Cap::Invariants: return "oracle.invariants";
    case Cap::Postcondition: return "oracle.postcondition";
    case Cap::Encode: return "oracle.encode";
    case Cap::Shadow: return "oracle.shadow";
    case Cap::Freeze: return "oracle.freeze";
    case Cap::Forward: return "oracle.forward";
    case Cap::Reverse: return "oracle.reverse";
    case Cap::Ledger: return "oracle.ledger";
    default: return "";
  }
}

// Launch-only toggles — never levels.
class Capabilities {
 public:
  void enable(Cap c) { bits_ |= (1u << static_cast<uint8_t>(c)); }
  void disable(Cap c) { bits_ &= ~(1u << static_cast<uint8_t>(c)); }
  bool enabled(Cap c) const {
    return (bits_ & (1u << static_cast<uint8_t>(c))) != 0;
  }

  // Preset "lab" expands to the printable list (not a level).
  void applyPresetLab() {
    enable(Cap::Invariants);
    enable(Cap::Postcondition);
    enable(Cap::Encode);
    enable(Cap::Shadow);
    enable(Cap::Freeze);
    enable(Cap::Forward);
    enable(Cap::Reverse);
    enable(Cap::Ledger);
  }

  std::vector<std::string> listEnabled() const {
    std::vector<std::string> out;
    for (uint8_t i = 0; i < static_cast<uint8_t>(Cap::Count); ++i) {
      auto c = static_cast<Cap>(i);
      if (enabled(c)) out.push_back(capName(c));
    }
    return out;
  }

  // Parse argv flags like --oracle.forward --oracle.preset=lab
  void parseArgs(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
      std::string_view a = argv[i];
      if (a == "--oracle.preset=lab" || a == "--oracle.preset") {
        applyPresetLab();
        continue;
      }
      for (uint8_t k = 0; k < static_cast<uint8_t>(Cap::Count); ++k) {
        auto c = static_cast<Cap>(k);
        std::string flag = std::string("--") + capName(c);
        if (a == flag) enable(c);
      }
    }
  }

 private:
  uint32_t bits_{0};
};

}  // namespace speculum::oracle
