#include "speculum/AssetDest.h"

#include <cstdio>

int main() {
  if (!speculum::AssetCanExit(speculum::AssetDest::Image)) return 1;
  if (!speculum::AssetCanExit(speculum::AssetDest::Font)) return 1;
  if (speculum::AssetCanExit(speculum::AssetDest::Html)) return 1;
  if (speculum::AssetCanExit(speculum::AssetDest::Js)) return 1;
  if (speculum::AssetCanExit(speculum::AssetDest::Unknown)) return 1;
  if (speculum::AssetDestFromFetch("image") != speculum::AssetDest::Image) return 1;
  if (speculum::AssetDestFromFetch("script") != speculum::AssetDest::Js) return 1;
  std::printf("ok asset dest\n");
  return 0;
}
