// Destino do pedido. Dúvida = recusa. Sem Firefox.
#pragma once

#include <cstdint>
#include <cstring>

namespace speculum {

enum class AssetDest : uint8_t {
  Unknown = 0,
  Image = 1,
  Font = 2,
  Audio = 3,
  Video = 4,
  Hls = 5,
  Html = 10,
  Js = 11,
  Css = 12,
  Xhr = 13,
  Sse = 14,
  Ws = 15,
};

inline bool AssetCanExit(AssetDest dest) {
  switch (dest) {
    case AssetDest::Image:
    case AssetDest::Font:
    case AssetDest::Audio:
    case AssetDest::Video:
    case AssetDest::Hls:
      return true;
    default:
      return false;
  }
}

inline AssetDest AssetDestFromFetch(const char* dest) {
  if (!dest) {
    return AssetDest::Xhr;
  }
  if (std::strcmp(dest, "image") == 0) return AssetDest::Image;
  if (std::strcmp(dest, "font") == 0) return AssetDest::Font;
  if (std::strcmp(dest, "audio") == 0) return AssetDest::Audio;
  if (std::strcmp(dest, "video") == 0) return AssetDest::Video;
  if (std::strcmp(dest, "script") == 0) return AssetDest::Js;
  if (std::strcmp(dest, "style") == 0) return AssetDest::Css;
  if (std::strcmp(dest, "websocket") == 0) return AssetDest::Ws;
  if (std::strcmp(dest, "document") == 0 || std::strcmp(dest, "frame") == 0 ||
      std::strcmp(dest, "iframe") == 0 || std::strcmp(dest, "embed") == 0 ||
      std::strcmp(dest, "object") == 0 || std::strcmp(dest, "manifest") == 0 ||
      std::strcmp(dest, "report") == 0) {
    return AssetDest::Html;
  }
  if (dest[0] == '\0') return AssetDest::Xhr;
  return AssetDest::Unknown;
}

}  // namespace speculum
