/* Speculum — mint do contextId aninhado no nascimento da BrowsingContext. */
#include "SpeculumMint.h"

#include "SpeculumLog.h"
#include "SpeculumProjectionRuntime.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/ContentChild.h"
#include "nsXULAppAPI.h"

namespace mozilla::dom {

uint32_t SpeculumMintNestedContextId() {
  return SpeculumProjectionRuntime::MintNestedContextId();
}

uint32_t SpeculumMintNestedIfProjected(BrowsingContext* aParentBc,
                                       bool aIsContent, bool aIsForPrinting) {
  if (!aParentBc || !aIsContent || aIsForPrinting) {
    return 0;
  }
  BrowsingContext* top = aParentBc->Top();
  if (!top || top->GetSpeculumContextId() == 0) {
    return 0;
  }

  if (XRE_IsParentProcess()) {
    return SpeculumMintNestedContextId();
  }

  ContentChild* cc = ContentChild::GetSingleton();
  if (!cc) {
    return 0;
  }
  uint32_t minted = 0;
  if (!cc->SendSpeculumMintContextId(&minted) || minted < 2) {
    SPECULUM_LOG("[SPECULUM-MINT] IPDL falhou ou devolveu %u — fecha sem inventar",
                 minted);
    return 0;
  }
  SPECULUM_LOG("[SPECULUM-MINT] nested=%u top=%u", minted,
               top->GetSpeculumContextId());
  return minted;
}

}  // namespace mozilla::dom
