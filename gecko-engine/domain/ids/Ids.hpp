#pragma once

#include <cstdint>

namespace speculum {

// Opaque typed id. Never zero. Monotonic per Minter. No reuse.
template <class Space>
class Id {
 public:
  constexpr Id() : v_(0) {}
  explicit constexpr Id(uint32_t v) : v_(v) {}
  constexpr uint32_t value() const { return v_; }
  constexpr bool valid() const { return v_ != 0; }
  constexpr explicit operator bool() const { return valid(); }
  friend constexpr bool operator==(Id a, Id b) { return a.v_ == b.v_; }
  friend constexpr bool operator!=(Id a, Id b) { return a.v_ != b.v_; }

 private:
  uint32_t v_;
};

struct ViewportSpace {};
struct HostSpace {};
struct NodeSpace {};
struct SheetSpace {};
struct RuleSpace {};
struct AtomSpace {};

using ViewportId = Id<ViewportSpace>;
using HostId = Id<HostSpace>;
using CorrelationId = uint32_t;

// Document identity is (HostId, Generation) — no global DocumentRef mint (11-identidade).
struct Generation {
  uint32_t value{0};
  constexpr explicit Generation(uint32_t v = 0) : value(v) {}
  constexpr bool operator==(Generation o) const { return value == o.value; }
};

// Opaque engine handle — table of handles lives in the engine, not here.
template <class Space>
class Ref {
 public:
  constexpr Ref() : v_(0) {}
  explicit constexpr Ref(uint32_t v) : v_(v) {}
  constexpr uint32_t value() const { return v_; }
  constexpr bool valid() const { return v_ != 0; }
  constexpr explicit operator bool() const { return valid(); }
  friend constexpr bool operator==(Ref a, Ref b) { return a.v_ == b.v_; }

 private:
  uint32_t v_;
};

using NodeRef = Ref<NodeSpace>;
using SheetRef = Ref<SheetSpace>;
using RuleRef = Ref<RuleSpace>;
using AtomRef = Ref<AtomSpace>;

template <class Space>
class Minter {
 public:
  Id<Space> mint() {
    // Never zero; no reuse.
    ++next_;
    return Id<Space>(next_);
  }
  uint32_t minted() const { return next_; }

 private:
  uint32_t next_{0};
};

using ViewportMinter = Minter<ViewportSpace>;
using HostMinter = Minter<HostSpace>;

struct ProcessSpace {};
using ProcessId = Id<ProcessSpace>;
using ProcessMinter = Minter<ProcessSpace>;

// Document identity = (hostId, generation) — no global mint (11-identidade).
struct DocumentId {
  HostId host{};
  Generation generation{};
  constexpr bool valid() const { return host.valid() && generation.value != 0; }
  constexpr explicit operator bool() const { return valid(); }
  friend constexpr bool operator==(DocumentId a, DocumentId b) {
    return a.host == b.host && a.generation == b.generation;
  }
  friend constexpr bool operator!=(DocumentId a, DocumentId b) { return !(a == b); }
};

}  // namespace speculum
