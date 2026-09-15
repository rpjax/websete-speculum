/* Speculum — runtime de projeção no processo base (doc 17). */
#ifndef dom_ipc_SpeculumProjectionRuntime_h
#define dom_ipc_SpeculumProjectionRuntime_h

#include "base/process_util.h"
#include "mozilla/UniquePtr.h"
#include "nsStringFwd.h"
#include "nsTArray.h"

class SpeculumProjectionRuntime {
 public:
  static void Startup();
  static SpeculumProjectionRuntime& Get();

  void DeliverFrame(uint32_t aContextId, uint64_t aDocToken, uint32_t aSequence,
                    base::ProcessId aChildPid, nsTArray<uint8_t>& aFrame);
  void DeliverSnapshot(uint32_t aContextId, uint32_t aCorrelationId,
                       uint32_t aSequence, uint32_t aGeneration,
                       uint64_t aTableHash, nsTArray<uint8_t>& aDump);
  void DeliverDialogRequested(uint32_t aContextId, uint32_t aRequestId,
                              const nsACString& aDescription);
  void DeliverPermissionRequested(uint32_t aContextId, uint32_t aRequestId,
                                  const nsACString& aDescription);
  void DeliverDownloadRequested(uint32_t aContextId, uint32_t aRequestId,
                                const nsACString& aDescription);

  // Próximo contextId aninhado (≥ 2). Sessão-global, nunca reusa. 0 se o
  // runtime ainda não subiu. Só o processo pai.
  static uint32_t MintNestedContextId();

 private:
  SpeculumProjectionRuntime();
  ~SpeculumProjectionRuntime();

  SpeculumProjectionRuntime(const SpeculumProjectionRuntime&) = delete;
  SpeculumProjectionRuntime& operator=(const SpeculumProjectionRuntime&) = delete;

  struct Impl;
  mozilla::UniquePtr<Impl> mImpl;
};

#endif
