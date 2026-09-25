#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "domain/Result.hpp"
#include "domain/fault/Fault.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum::assets {

enum class AssetDest : uint8_t {
  Image = 0,
  Font = 1,
  Media = 2,
  Style = 3,
  Script = 4,
  Document = 5,
  Fetch = 6,
  Other = 7
};

inline bool isServable(AssetDest d) {
  switch (d) {
    case AssetDest::Image:
    case AssetDest::Font:
    case AssetDest::Media:
      return true;
    default:
      return false;
  }
}

enum class StreamPhase : uint8_t {
  Requested = 0,
  Streaming = 1,
  Denied = 2,
  Complete = 3,
  Cancelled = 4
};

using StreamId = uint32_t;

// Max concurrent live asset streams per session. Provisional — reafin on target host.
inline constexpr size_t kMaxConcurrentAssetStreams = 32;

struct Stream {
  StreamId id{0};
  DocumentId doc{};
  AssetDest dest{AssetDest::Other};
  std::string url;
  StreamPhase phase{StreamPhase::Requested};
  uint64_t offset{0};

  bool live() const {
    return phase == StreamPhase::Requested || phase == StreamPhase::Streaming;
  }
};

class Streams {
 public:
  Result<StreamId> open(DocumentId doc, AssetDest dest, std::string_view url) {
    if (!doc.valid()) {
      return Result<StreamId>::failure(
          fault::makeFault(fault::FaultCode::NoSuchDocument, "Streams", "invalid document"));
    }
    if (live() >= kMaxConcurrentAssetStreams) {
      return Result<StreamId>::failure(fault::makeFault(fault::FaultCode::AssetTooManyStreams,
                                                     "Streams", "concurrent stream ceiling"));
    }
    StreamId id = ++next_;  // never zero reuse: monotonic
    Stream s;
    s.id = id;
    s.doc = doc;
    s.dest = dest;
    s.url.assign(url.begin(), url.end());
    s.phase = StreamPhase::Requested;
    by_id_[id] = s;
    return Result<StreamId>::success(id);
  }

  Stream* find(StreamId id) {
    auto it = by_id_.find(id);
    return it == by_id_.end() ? nullptr : &it->second;
  }

  void cancelAllOfDocument(DocumentId doc) {
    for (auto& [id, s] : by_id_) {
      (void)id;
      if (s.doc == doc && s.live()) s.phase = StreamPhase::Cancelled;
    }
  }

  void cancelAll() {
    for (auto& [id, s] : by_id_) {
      (void)id;
      if (s.live()) s.phase = StreamPhase::Cancelled;
    }
  }

  size_t live() const {
    size_t n = 0;
    for (const auto& [id, s] : by_id_) {
      (void)id;
      if (s.live()) ++n;
    }
    return n;
  }

  size_t liveOf(DocumentId doc) const {
    size_t n = 0;
    for (const auto& [id, s] : by_id_) {
      (void)id;
      if (s.doc == doc && s.live()) ++n;
    }
    return n;
  }

 private:
  StreamId next_{0};
  std::unordered_map<StreamId, Stream> by_id_;
};

}  // namespace speculum::assets
