#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"
#include "domain/producer/Types.hpp"

namespace speculum::oracle {

using FreezeToken = uint32_t;  // 0 = invalid
using FieldId = std::string;   // e.g. "a:class", "value", "rowHash"
using SpanId = uint32_t;

enum class Direction : uint8_t { None = 0, Forward = 1, Reverse = 2 };

struct ExclusionEntry {
  producer::NodeId id{0};
  NodeKind kind{NodeKind::Element};
  std::string name;
  std::string reason;  // "policy:userAgentOwned" etc.
};

struct ExclusionLedger {
  std::vector<ExclusionEntry> entries;
  void add(ExclusionEntry e) { entries.push_back(std::move(e)); }
  std::string print() const {
    std::string s;
    for (const auto& e : entries) {
      s += std::to_string(e.id) + " " + e.name + " — " + e.reason + "\n";
    }
    return s;
  }
};

struct ImageNode {
  producer::NodeId id{0};
  NodeKind kind{NodeKind::Element};
  ElementNs ns{ElementNs::Html};
  std::string name;
  std::string value;
  producer::NodeId parent{0};
  producer::NodeId prevSibling{0};
  std::unordered_map<std::string, std::string> attrs;
  producer::FieldHash rowHash{0};
  producer::FieldHash contentHash{0};
  std::unordered_map<std::string, producer::FieldHash> fieldHash;
  bool userAgentOwned{false};
};

struct TableImage {
  HostId host{};
  Generation generation{};
  uint32_t sequence{0};
  std::vector<ImageNode> nodes;
};

struct NaiveImage {
  HostId host{};
  std::vector<ImageNode> nodes;  // every visible node, no policy
};

struct DescriptorImage {
  HostId host{};
  Generation generation{};
  std::vector<ImageNode> nodes;  // d(VN) snapshots (hash filled)
};

struct Verdict {
  bool ok{true};
  Direction failedIn{Direction::None};
  HostId host{};
  Generation generation{};
  uint32_t sequence{0};
  producer::NodeId row{0};
  FieldId field;
  uint64_t expected{0};
  uint64_t actual{0};
  SpanId causeSpan{0};
  std::string roteiroExcerpt;
  ExclusionLedger excluded;
};

}  // namespace speculum::oracle
