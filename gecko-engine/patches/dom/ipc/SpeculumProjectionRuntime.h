/* Speculum — runtime de projeção no processo base (doc 17). */
#ifndef dom_ipc_SpeculumProjectionRuntime_h
#define dom_ipc_SpeculumProjectionRuntime_h

#include "base/process_util.h"
#include "mozilla/UniquePtr.h"
#include "nsTArray.h"

class SpeculumProjectionRuntime {
 public:
  static void Startup();
  static SpeculumProjectionRuntime& Get();

  void DeliverFrame(uint32_t aContextId, uint64_t aDocToken, uint32_t aSequence,
                    base::ProcessId aChildPid, nsTArray<uint8_t>& aFrame);

 private:
  SpeculumProjectionRuntime();
  ~SpeculumProjectionRuntime();

  SpeculumProjectionRuntime(const SpeculumProjectionRuntime&) = delete;
  SpeculumProjectionRuntime& operator=(const SpeculumProjectionRuntime&) = delete;

  struct Impl;
  mozilla::UniquePtr<Impl> mImpl;
};

#endif
