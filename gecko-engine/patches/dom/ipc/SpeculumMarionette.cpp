/* Speculum — marionete: espera DialogRespond. Nunca responde sozinho. */
#include "SpeculumMarionette.h"

#include "SpeculumLog.h"
#include "SpeculumProjectionRuntime.h"
#include "mozilla/Monitor.h"
#include "mozilla/SpinEventLoopUntil.h"
#include "mozilla/dom/BrowsingContext.h"
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

bool SendAsk(SpeculumAskKind aKind, uint32_t aContextId, uint32_t aRequestId,
             const nsACString& aDescription) {
  if (XRE_IsContentProcess()) {
    mozilla::dom::ContentChild* cc = mozilla::dom::ContentChild::GetSingleton();
    if (!cc) {
      SPECULUM_LOG("[SPECULUM-ASK] sem ContentChild ctx=%u", aContextId);
      return false;
    }
    switch (aKind) {
      case SpeculumAskKind::Permission:
        return cc->SendSpeculumPermissionRequested(aContextId, aRequestId,
                                                   nsCString(aDescription));
      case SpeculumAskKind::Download:
        return cc->SendSpeculumDownloadRequested(aContextId, aRequestId,
                                                 nsCString(aDescription));
      case SpeculumAskKind::Dialog:
      default:
        return cc->SendSpeculumDialogRequested(aContextId, aRequestId,
                                               nsCString(aDescription));
    }
  }
  if (XRE_IsParentProcess()) {
    switch (aKind) {
      case SpeculumAskKind::Permission:
        SpeculumProjectionRuntime::Get().DeliverPermissionRequested(
            aContextId, aRequestId, aDescription);
        return true;
      case SpeculumAskKind::Download:
        SpeculumProjectionRuntime::Get().DeliverDownloadRequested(
            aContextId, aRequestId, aDescription);
        return true;
      case SpeculumAskKind::Dialog:
      default:
        SpeculumProjectionRuntime::Get().DeliverDialogRequested(
            aContextId, aRequestId, aDescription);
        return true;
    }
  }
  return false;
}

bool WaitRegistered(uint32_t aContextId, uint32_t aRequestId,
                    nsACString& aAnswer) {
  const uint64_t key = Key(aContextId, aRequestId);
  bool ok = mozilla::SpinEventLoopUntil("SpeculumWaitDialog"_ns, [&]() {
    mozilla::MonitorAutoLock lock(gDialogMon);
    auto it = gPending.find(key);
    return it != gPending.end() && it->second.done;
  });
  mozilla::MonitorAutoLock lock(gDialogMon);
  auto it = gPending.find(key);
  if (!ok || it == gPending.end() || !it->second.done) {
    if (it != gPending.end()) {
      gPending.erase(it);
    }
    return false;
  }
  aAnswer = it->second.answer;
  gPending.erase(it);
  return true;
}

}  // namespace

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
  {
    mozilla::MonitorAutoLock lock(gDialogMon);
    gPending[Key(aContextId, requestId)] = AskPending{};
  }
  SPECULUM_LOG("[SPECULUM-ASK] kind=%u ctx=%u req=%u", uint32_t(aKind),
               aContextId, requestId);
  // Sync no conteúdo→pai: o pedido está no WS antes do spin. Async + spin
  // depois deixava o Recv do pai atrás de um Navigate ainda na stack, e o
  // consumidor nunca via DialogRequested. O prompt nativo do Gecko também é
  // sync nesta direção.
  if (!SendAsk(aKind, aContextId, requestId, aDescription)) {
    mozilla::MonitorAutoLock lock(gDialogMon);
    gPending.erase(Key(aContextId, requestId));
    SPECULUM_LOG("[SPECULUM-ASK] send falhou ctx=%u req=%u", aContextId,
                 requestId);
    return false;
  }
  return WaitRegistered(aContextId, requestId, aAnswer);
}

bool SpeculumTryAskDialog(mozilla::dom::BrowsingContext* aBc,
                          const nsAString& aMessage, nsACString& aAnswer) {
  if (!aBc) {
    return false;
  }
  uint32_t ctx = aBc->GetSpeculumContextId();
  if (!ctx) {
    if (mozilla::dom::BrowsingContext* top = aBc->Top()) {
      ctx = top->GetSpeculumContextId();
    }
  }
  if (!ctx) {
    return false;
  }
  nsAutoCString desc;
  CopyUTF16toUTF8(aMessage, desc);
  (void)SpeculumAskAndWait(ctx, SpeculumAskKind::Dialog, desc, aAnswer);
  return true;
}
