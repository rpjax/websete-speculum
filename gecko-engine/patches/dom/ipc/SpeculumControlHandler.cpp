/* Speculum — controle binário no processo pai (doc 18). */
#include "SpeculumControlHandler.h"

#include "SpeculumControlAbi.h"
#include "SpeculumSupervisorLink.h"
#include "mozilla/SystemPrincipal.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/ContentParent.h"
#include "mozilla/ErrorResult.h"
#include "mozilla/NullPrincipal.h"
#include "mozilla/StaticMutex.h"
#include "nsGlobalWindowOuter.h"
#include "nsComponentManagerUtils.h"
#include "nsIMutableArray.h"
#include "nsIURI.h"
#include "nsIWindowWatcher.h"
#include "nsNetUtil.h"
#include "nsPIDOMWindow.h"
#include "nsPIDOMWindowInlines.h"
#include "nsSupportsPrimitives.h"
#include "nsThreadUtils.h"
#include <map>
#include <utility>

using mozilla::ErrorResult;
using mozilla::StaticMutex;
using mozilla::StaticMutexAutoLock;
using mozilla::SystemPrincipal;
using mozilla::dom::BrowsingContext;
using mozilla::dom::ContentParent;
using mozilla::NullPrincipal;

StaticMutex sSpeculumProjectedMutex;
std::map<uint32_t, RefPtr<BrowsingContext>> sContextToRootBc;
std::map<uint64_t, uint32_t> sBcIdToContextId;
std::map<uint32_t, nsCOMPtr<mozIDOMWindowProxy>> sContextToWindow;

static void SendControlEvent(const uint8_t* aPayload, uint32_t aLength) {
  GetSpeculumSupervisorLink().SendBrowserEvent(
      0, reinterpret_cast<const char*>(aPayload), aLength);
}

static void SendFault(uint32_t aCorrelationId, uint32_t aContextId,
                      const char* aReason) {
  uint8_t buffer[512];
  SpeculumControlWriter writer(buffer, sizeof(buffer),
                             SpeculumControlOpCode::Fault, aCorrelationId);
  if (!writer.WriteUInt32(aContextId) ||
      !writer.WriteString(nsDependentCString(aReason)) ||
      !writer.Ok()) {
    fprintf(stderr,
            "[SPECULUM-CTRL-ERR] falha ao codificar Fault correlationId=%u\n",
            aCorrelationId);
    return;
  }
  SendControlEvent(buffer, static_cast<uint32_t>(writer.Length()));
}

static void BroadcastProjectContext(uint64_t aBrowsingContextId,
                                    uint32_t aContextId) {
  for (auto* cp : ContentParent::AllProcesses(ContentParent::eLive)) {
    (void)cp->SendSpeculumProjectContext(aBrowsingContextId, aContextId);
  }
}

static void BroadcastUnprojectContext(uint64_t aBrowsingContextId) {
  for (auto* cp : ContentParent::AllProcesses(ContentParent::eLive)) {
    (void)cp->SendSpeculumUnprojectContext(aBrowsingContextId);
  }
}

static nsresult OpenSpeculumBrowserWindow(int32_t aWidth, int32_t aHeight,
                                          mozIDOMWindowProxy** aOutWindow) {
  nsCOMPtr<nsIURI> uri;
  nsresult rv = NS_NewURI(getter_AddRefs(uri), "about:blank"_ns);
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoCString uriToLoad;
  rv = uri->GetSpec(uriToLoad);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsISupportsCString> nsUriToLoad =
      do_CreateInstance(NS_SUPPORTS_CSTRING_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = nsUriToLoad->SetData(uriToLoad);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsISupportsPRBool> nsFalse =
      do_CreateInstance(NS_SUPPORTS_PRBOOL_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = nsFalse->SetData(false);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsISupportsPRUint32> userContextId =
      do_CreateInstance(NS_SUPPORTS_PRUINT32_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = userContextId->SetData(0);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIPrincipal> principal =
      NullPrincipal::CreateWithoutOriginAttributes();

  nsCOMPtr<nsIMutableArray> args = do_CreateInstance(NS_ARRAY_CONTRACTID);
  NS_ENSURE_TRUE(args, NS_ERROR_FAILURE);
  args->AppendElement(nsUriToLoad);
  args->AppendElement(nullptr);
  args->AppendElement(nullptr);
  args->AppendElement(nullptr);
  args->AppendElement(nsFalse);
  args->AppendElement(userContextId);
  args->AppendElement(nullptr);
  args->AppendElement(nullptr);
  args->AppendElement(principal);
  args->AppendElement(nsFalse);
  args->AppendElement(nullptr);
  args->AppendElement(nullptr);

  nsCOMPtr<nsIWindowWatcher> ww = do_GetService(NS_WINDOWWATCHER_CONTRACTID);
  NS_ENSURE_TRUE(ww, NS_ERROR_FAILURE);

  nsAutoCString features("chrome,all,dialog=no"_ns);
  if (aWidth > 0) {
    features.AppendPrintf(",width=%d", aWidth);
  }
  if (aHeight > 0) {
    features.AppendPrintf(",height=%d", aHeight);
  }

  return ww->OpenWindow(nullptr, nsDependentCString(BROWSER_CHROME_URL_QUOTED),
                        "_blank"_ns, features, args, aOutWindow);
}

static void HandleContextCreate(uint32_t aCorrelationId, uint32_t aContextId,
                                int32_t aWidth, int32_t aHeight) {
  StaticMutexAutoLock lock(sSpeculumProjectedMutex);
  if (sContextToRootBc.find(aContextId) != sContextToRootBc.end()) {
    SendFault(aCorrelationId, aContextId, "contextId already registered");
    return;
  }

  nsCOMPtr<mozIDOMWindowProxy> window;
  nsresult rv =
      OpenSpeculumBrowserWindow(aWidth, aHeight, getter_AddRefs(window));
  if (NS_FAILED(rv) || !window) {
    SendFault(aCorrelationId, aContextId, "OpenWindow failed");
    return;
  }

  nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(window);
  if (!outer) {
    SendFault(aCorrelationId, aContextId, "no outer window");
    return;
  }

  RefPtr<BrowsingContext> bc = outer->GetBrowsingContext();
  if (!bc) {
    SendFault(aCorrelationId, aContextId, "no browsing context");
    return;
  }
  bc = bc->Top();
  if (!bc) {
    SendFault(aCorrelationId, aContextId, "no top browsing context");
    return;
  }

  const uint64_t bcId = bc->Id();
  if (sBcIdToContextId.find(bcId) != sBcIdToContextId.end()) {
    SendFault(aCorrelationId, aContextId, "browsing context already registered");
    return;
  }

  sContextToRootBc.emplace(aContextId, bc);
  sBcIdToContextId.emplace(bcId, aContextId);
  sContextToWindow.emplace(aContextId, window);

  BroadcastProjectContext(bcId, aContextId);

  uint8_t buffer[64];
  SpeculumControlWriter writer(buffer, sizeof(buffer),
                               SpeculumControlOpCode::ContextCreated,
                               aCorrelationId);
  if (!writer.WriteUInt32(aContextId) || !writer.WriteUInt64(bcId) ||
      !writer.WriteUInt32(0) || !writer.Ok()) {
    SendFault(aCorrelationId, aContextId, "ContextCreated encode failed");
    return;
  }
  SendControlEvent(buffer, static_cast<uint32_t>(writer.Length()));
}

static void HandleContextDestroy(uint32_t aCorrelationId, uint32_t aContextId) {
  RefPtr<BrowsingContext> bc;
  nsCOMPtr<mozIDOMWindowProxy> window;
  uint64_t bcId = 0;

  {
    StaticMutexAutoLock lock(sSpeculumProjectedMutex);
    const auto found = sContextToRootBc.find(aContextId);
    if (found == sContextToRootBc.end()) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    bc = found->second;
    bcId = bc->Id();
    const auto winIt = sContextToWindow.find(aContextId);
    if (winIt != sContextToWindow.end()) {
      window = winIt->second;
    }
    sContextToRootBc.erase(found);
    sBcIdToContextId.erase(bcId);
    sContextToWindow.erase(aContextId);
  }

  BroadcastUnprojectContext(bcId);

  if (window) {
    if (nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(window)) {
      outer->ForceClose();
    }
  }

  uint8_t buffer[32];
  SpeculumControlWriter writer(buffer, sizeof(buffer),
                               SpeculumControlOpCode::ContextDestroyed,
                               aCorrelationId);
  if (!writer.WriteUInt32(aContextId) || !writer.Ok()) {
    SendFault(aCorrelationId, aContextId, "ContextDestroyed encode failed");
    return;
  }
  SendControlEvent(buffer, static_cast<uint32_t>(writer.Length()));
}

static void HandleNavigate(uint32_t aCorrelationId, uint32_t aContextId,
                           const nsACString& aUrl) {
  RefPtr<BrowsingContext> bc;
  {
    StaticMutexAutoLock lock(sSpeculumProjectedMutex);
    const auto found = sContextToRootBc.find(aContextId);
    if (found == sContextToRootBc.end()) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    bc = found->second;
  }

  if (!bc || bc->IsDiscarded()) {
    SendFault(aCorrelationId, aContextId, "browsing context unavailable");
    return;
  }

  if (!bc->IsTargetable()) {
    SendFault(aCorrelationId, aContextId, "browsing context not targetable");
    return;
  }

  nsCOMPtr<nsIURI> uri;
  nsresult rv = NS_NewURI(getter_AddRefs(uri), aUrl);
  if (NS_FAILED(rv) || !uri) {
    SendFault(aCorrelationId, aContextId, "invalid url");
    return;
  }

  nsAutoCString spec;
  rv = uri->GetSpec(spec);
  if (NS_FAILED(rv)) {
    SendFault(aCorrelationId, aContextId, "url spec failed");
    return;
  }

  RefPtr<nsIPrincipal> systemPrincipal = SystemPrincipal::Get();
  ErrorResult error;
  bc->Navigate(uri, /* aSourceDocument */ nullptr, *systemPrincipal, error);
  if (error.Failed()) {
    SendFault(aCorrelationId, aContextId, "navigate failed");
    return;
  }

  uint8_t buffer[4096];
  SpeculumControlWriter writer(buffer, sizeof(buffer),
                               SpeculumControlOpCode::Navigated, aCorrelationId);
  if (!writer.WriteUInt32(aContextId) || !writer.WriteString(spec) ||
      !writer.Ok()) {
    SendFault(aCorrelationId, aContextId, "Navigated encode failed");
    return;
  }
  SendControlEvent(buffer, static_cast<uint32_t>(writer.Length()));
}

static void HandleControlBinary(const uint8_t* aData, size_t aLength) {
  SpeculumControlReader reader(aData, aLength);
  if (!reader.Ok()) {
    fprintf(stderr, "[SPECULUM-CTRL-ERR] mensagem truncada (cabecalho)\n");
    return;
  }

  const uint16_t op = reader.OpCode();
  const uint32_t correlationId = reader.CorrelationId();
  fprintf(stderr, "[SPECULUM-CTRL] opcode=0x%04x correlationId=%u\n", op,
          correlationId);

  switch (static_cast<SpeculumControlOpCode>(op)) {
    case SpeculumControlOpCode::ContextCreate: {
      uint32_t contextId = 0;
      int32_t width = 0;
      int32_t height = 0;
      if (!reader.ReadUInt32(&contextId) || !reader.ReadInt32(&width) ||
          !reader.ReadInt32(&height)) {
        SendFault(correlationId, 0, "ContextCreate truncated");
        return;
      }
      HandleContextCreate(correlationId, contextId, width, height);
      return;
    }
    case SpeculumControlOpCode::ContextDestroy: {
      uint32_t contextId = 0;
      if (!reader.ReadUInt32(&contextId)) {
        SendFault(correlationId, 0, "ContextDestroy truncated");
        return;
      }
      HandleContextDestroy(correlationId, contextId);
      return;
    }
    case SpeculumControlOpCode::Navigate: {
      uint32_t contextId = 0;
      nsAutoCString url;
      if (!reader.ReadUInt32(&contextId) || !reader.ReadString(url)) {
        SendFault(correlationId, 0, "Navigate truncated");
        return;
      }
      HandleNavigate(correlationId, contextId, url);
      return;
    }
    default:
      fprintf(stderr,
              "[SPECULUM-CTRL-IGNORADO] opcode=0x%04x correlationId=%u\n", op,
              correlationId);
      return;
  }
}

void SpeculumDispatchControlPayload(const uint8_t* aPayload, size_t aLength) {
  if (!aPayload || aLength == 0) {
    return;
  }
  nsTArray<uint8_t> payload;
  if (!payload.AppendElements(aPayload, aLength, mozilla::fallible)) {
    fprintf(stderr, "[SPECULUM-CTRL-ERR] alloc falhou len=%zu\n", aLength);
    return;
  }
  NS_DispatchToMainThread(NS_NewRunnableFunction(
      "SpeculumHandleControl",
      [payload = std::move(payload)]() {
        HandleControlBinary(payload.Elements(), payload.Length());
      }));
}

void SpeculumReplayProjectedContexts(mozilla::dom::ContentParent* aChild) {
  if (!aChild) {
    return;
  }
  StaticMutexAutoLock lock(sSpeculumProjectedMutex);
  for (const auto& entry : sContextToRootBc) {
    if (RefPtr<BrowsingContext> bc = entry.second) {
      (void)aChild->SendSpeculumProjectContext(bc->Id(), entry.first);
    }
  }
}
