#pragma once

#include "domain/Result.hpp"
#include "domain/Types.hpp"
#include "domain/ids/Ids.hpp"
#include "ports/IDocumentObserver.hpp"
#include "ports/IDocumentView.hpp"

namespace speculum {

class IDocumentObserver;

class IEngineDocument {
 public:
  virtual ~IEngineDocument() = default;

  virtual DocumentId id() const = 0;
  virtual const IDocumentView& view() const = 0;
  virtual void attach(IDocumentObserver*) = 0;
  virtual Result<void> dispatch(NodeRef target, const ResolvedGesture&) = 0;
  virtual Box boxOf(NodeRef) const = 0;
};

}  // namespace speculum
