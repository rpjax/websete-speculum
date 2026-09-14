/* Speculum — marionete: espera DialogRespond. Nunca responde sozinho. */
#include "SpeculumMarionette.h"

#include "mozilla/Monitor.h"
#include "mozilla/SpinEventLoopUntil.h"

#include <map>

namespace {

struct Pending {
  nsCString answer;
  bool done = false;
};

mozilla::Monitor gDialogMon{"SpeculumDialog"};
std::map<uint64_t, Pending> gPending;

uint64_t Key(uint32_t aContextId, uint32_t aRequestId) {
  return (uint64_t(aContextId) << 32) | aRequestId;
}

}  // namespace

bool SpeculumWaitDialogRespond(uint32_t aContextId, uint32_t aRequestId,
                               const nsACString& /*aDescription*/,
                               nsACString& aAnswer) {
  const uint64_t key = Key(aContextId, aRequestId);
  {
    mozilla::MonitorAutoLock lock(gDialogMon);
    gPending[key] = Pending{};
  }
  bool ok = mozilla::SpinEventLoopUntil("SpeculumWaitDialog"_ns, [&]() {
    mozilla::MonitorAutoLock lock(gDialogMon);
    auto it = gPending.find(key);
    return it != gPending.end() && it->second.done;
  });
  mozilla::MonitorAutoLock lock(gDialogMon);
  auto it = gPending.find(key);
  if (!ok || it == gPending.end() || !it->second.done) {
    return false;
  }
  aAnswer = it->second.answer;
  gPending.erase(it);
  return true;
}

void SpeculumCompleteDialog(uint32_t aContextId, uint32_t aRequestId,
                            const nsACString& aAnswer) {
  mozilla::MonitorAutoLock lock(gDialogMon);
  auto& p = gPending[Key(aContextId, aRequestId)];
  p.answer.Assign(aAnswer);
  p.done = true;
  gDialogMon.NotifyAll();
}
