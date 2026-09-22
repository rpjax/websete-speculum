#pragma once

#include <string_view>

#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"

namespace speculum {

class IEngineDocument;

class IHostObserver {
 public:
  virtual ~IHostObserver() = default;

  virtual void onDocumentInstalled(const IEngineDocument&) = 0;
  virtual void onDocumentDiscarded(DocumentId) = 0;
  virtual void onLoad(bool ok, uint32_t httpStatus) = 0;
  virtual void onLocation(std::string_view url, bool replace) = 0;
  virtual void onTitle(std::string_view) = 0;
  virtual void onSecurity(std::string_view state) = 0;
  virtual void onFavicon(std::string_view url) = 0;
  virtual void onHistory(bool canBack, bool canForward) = 0;
  virtual void onStatus(std::string_view) = 0;
  virtual void onFindResult(uint32_t active, uint32_t total) = 0;
  virtual void onCrash() = 0;
};

}  // namespace speculum
