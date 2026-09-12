/* Speculum — NodeSource sobre nsINode (produtor PageProjection). */
#ifndef dom_base_SpeculumNodeSource_h
#define dom_base_SpeculumNodeSource_h

#include "mozilla/Assertions.h"
#ifndef SPECULUM_FATAL
#  define SPECULUM_FATAL(msg) MOZ_CRASH(msg)
#endif
#include "speculum/Producer.h"

class nsINode;

namespace mozilla::dom {
class Document;
}

void SpeculumTryWriteBootstrapFrame(mozilla::dom::Document* aDocument);

class SpeculumNodeSource final : public speculum::NodeSource {
 public:
  SpeculumNodeSource();
  uint64_t docToken() const { return mDocToken; }

  speculum::NodeKind kindOf(const void* node) const override;
  speculum::ElementNs nsOf(const void* node) const override;
  std::string uriOf(const void* node) const override;
  std::string nameOf(const void* node) const override;
  std::string valueOf(const void* node) const override;
  std::vector<speculum::AttrPair> attrsOf(const void* node) const override;
  std::vector<const void*> childrenOf(const void* node) const override;
  bool isUaOwned(const void* node) const override;

 private:
  uint64_t mDocToken;
};

#endif
