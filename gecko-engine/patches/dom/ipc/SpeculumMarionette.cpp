/* Speculum — marionete: espera DialogRespond. Nunca responde sozinho. */
#include "SpeculumMarionette.h"

#include "SpeculumProjectionRuntime.h"
#include "mozilla/Monitor.h"
#include "mozilla/SpinEventLoopUntil.h"
#include "mozilla/dom/ContentChild.h"
#include "nsXULAppAPI.h"

#include <atomic>
#include <map>

namespace {

struct AskPending {
  nsCString answer;
  bool done = false;
};

mozilla::Monitor gDialogMon{"SpeculumDialog"};
std::map<uint64_t, AskPending> gPending;

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
    gPending[key] = AskPending{};
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

uint32_t SpeculumNextRequestId() {
  static std::atomic<uint32_t> sNext{1};
  return sNext.fetch_add(1);
}

bool SpeculumAskAndWait(uint32_t aContextId, SpeculumAskKind aKind,
                        const nsACString& aDescription, nsACString& aAnswer) {
  const uint32_t requestId = SpeculumNextRequestId();
  if (XRE_IsContentProcess()) {
    if (mozilla::dom::ContentChild* cc =
            mozilla::dom::ContentChild::GetSingleton()) {
      switch (aKind) {
        case SpeculumAskKind::Permission:
          (void)cc->SendSpeculumPermissionRequested(aContextId, requestId,
                                                    nsCString(aDescription));
          break;
        case SpeculumAskKind::Download:
          (void)cc->SendSpeculumDownloadRequested(aContextId, requestId,
                                                  nsCString(aDescription));
          break;
        case SpeculumAskKind::Dialog:
        default:
          (void)cc->SendSpeculumDialogRequested(aContextId, requestId,
                                                nsCString(aDescription));
          break;
      }
    }
  } else if (XRE_IsParentProcess()) {
    switch (aKind) {
      case SpeculumAskKind::Permission:
        SpeculumProjectionRuntime::Get().DeliverPermissionRequested(
            aContextId, requestId, aDescription);
        break;
      case SpeculumAskKind::Download:
        SpeculumProjectionRuntime::Get().DeliverDownloadRequested(
            aContextId, requestId, aDescription);
        break;
      case SpeculumAskKind::Dialog:
      default:
        SpeculumProjectionRuntime::Get().DeliverDialogRequested(
            aContextId, requestId, aDescription);
        break;
    }
  }
  return SpeculumWaitDialogRespond(aContextId, requestId, aDescription,
                                   aAnswer);
}
