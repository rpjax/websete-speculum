/* Speculum — mint do contextId aninhado no nascimento da BrowsingContext. */
#ifndef mozilla_dom_SpeculumMint_h
#define mozilla_dom_SpeculumMint_h

#include <stdint.h>

namespace mozilla::dom {

class BrowsingContext;

// Próximo C ≥ 2. Só o processo pai. Nunca reusa. 0 se o runtime ainda não subiu.
uint32_t SpeculumMintNestedContextId();

// C no snapshot de nascimento. 0 se não for nested projetado.
// CreateFromIPC não chama isto — só herda o campo.
uint32_t SpeculumMintNestedIfProjected(BrowsingContext* aParentBc,
                                       bool aIsContent, bool aIsForPrinting);

}  // namespace mozilla::dom

#endif
