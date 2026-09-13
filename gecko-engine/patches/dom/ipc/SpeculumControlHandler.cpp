/* Speculum — ContextCreate/Destroy no processo pai (controle supervisor). */
#include "SpeculumControlHandler.h"

#include "SpeculumSupervisorLink.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/ContentParent.h"
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
#include "nsPrintfCString.h"
#include "nsSupportsPrimitives.h"
#include "nsThreadUtils.h"
#include <map>
#include <string>
#include <utility>

using mozilla::StaticMutex;
using mozilla::StaticMutexAutoLock;
using mozilla::dom::BrowsingContext;
using mozilla::dom::ContentParent;
using mozilla::NullPrincipal;

StaticMutex sSpeculumProjectedMutex;
std::map<uint32_t, RefPtr<BrowsingContext>> sContextToRootBc;
std::map<uint64_t, uint32_t> sBcIdToContextId;
std::map<uint32_t, nsCOMPtr<mozIDOMWindowProxy>> sContextToWindow;

static void SendBrowserEventJson(const nsACString& aJson) {
  GetSpeculumSupervisorLink().SendBrowserEvent(
      0, aJson.Data(), static_cast<uint32_t>(aJson.Length()));
}

static void SendFault(uint32_t aId, const char* aReason) {
  nsPrintfCString json(R"({"type":"Fault","id":%u,"reason":"%s"})", aId,
                       aReason);
  SendBrowserEventJson(json);
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

static bool JsonExtractString(const std::string& aJson, const char* aKey,
                       nsACString& aOut) {
  const nsAutoCString pattern(nsPrintfCString("\"%s\":\"", aKey));
  const char* start = strstr(aJson.c_str(), pattern.get());
  if (!start) {
    return false;
  }
  start += pattern.Length();
  const char* end = strchr(start, '"');
  if (!end) {
    return false;
  }
  aOut.Assign(Substring(start, end));
  return true;
}

static bool JsonExtractUint(const std::string& aJson, const char* aKey,
                     uint32_t* aOut) {
  const nsAutoCString pattern(nsPrintfCString("\"%s\":", aKey));
  const char* start = strstr(aJson.c_str(), pattern.get());
  if (!start) {
    return false;
  }
  start += pattern.Length();
  while (*start == ' ') {
    ++start;
  }
  char* endPtr = nullptr;
  const unsigned long value = strtoul(start, &endPtr, 10);
  if (endPtr == start) {
    return false;
  }
  *aOut = static_cast<uint32_t>(value);
  return true;
}

static bool JsonExtractInt(const std::string& aJson, const char* aKey,
                           int32_t* aOut) {
  const nsAutoCString pattern(nsPrintfCString("\"%s\":", aKey));
  const char* start = strstr(aJson.c_str(), pattern.get());
  if (!start) {
    return false;
  }
  start += pattern.Length();
  while (*start == ' ') {
    ++start;
  }
  char* endPtr = nullptr;
  const long value = strtol(start, &endPtr, 10);
  if (endPtr == start) {
    return false;
  }
  *aOut = static_cast<int32_t>(value);
  return true;
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

static void HandleContextCreate(uint32_t aId, uint32_t aContextId, int32_t aWidth,
                         int32_t aHeight) {
  StaticMutexAutoLock lock(sSpeculumProjectedMutex);
  if (sContextToRootBc.find(aContextId) != sContextToRootBc.end()) {
    SendFault(aId, "contextId already registered");
    return;
  }

  nsCOMPtr<mozIDOMWindowProxy> window;
  nsresult rv = OpenSpeculumBrowserWindow(aWidth, aHeight, getter_AddRefs(window));
  if (NS_FAILED(rv) || !window) {
    SendFault(aId, "OpenWindow failed");
    return;
  }

  nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(window);
  if (!outer) {
    SendFault(aId, "no outer window");
    return;
  }

  RefPtr<BrowsingContext> bc = outer->GetBrowsingContext();
  if (!bc) {
    SendFault(aId, "no browsing context");
    return;
  }
  bc = bc->Top();
  if (!bc) {
    SendFault(aId, "no top browsing context");
    return;
  }

  const uint64_t bcId = bc->Id();
  if (sBcIdToContextId.find(bcId) != sBcIdToContextId.end()) {
    SendFault(aId, "browsing context already registered");
    return;
  }

  sContextToRootBc.emplace(aContextId, bc);
  sBcIdToContextId.emplace(bcId, aContextId);
  sContextToWindow.emplace(aContextId, window);

  BroadcastProjectContext(bcId, aContextId);

  nsPrintfCString json(
      R"({"type":"ContextCreated","id":%u,"contextId":%u,"browsingContextId":%llu})",
      aId, aContextId, static_cast<unsigned long long>(bcId));
  SendBrowserEventJson(json);
}

static void HandleContextDestroy(uint32_t aId, uint32_t aContextId) {
  RefPtr<BrowsingContext> bc;
  nsCOMPtr<mozIDOMWindowProxy> window;
  uint64_t bcId = 0;

  {
    StaticMutexAutoLock lock(sSpeculumProjectedMutex);
    const auto found = sContextToRootBc.find(aContextId);
    if (found == sContextToRootBc.end()) {
      SendFault(aId, "unknown contextId");
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

  nsPrintfCString json(
      R"({"type":"ContextDestroyed","id":%u,"contextId":%u})", aId, aContextId);
  SendBrowserEventJson(json);
}

static void HandleControlJson(const std::string& aJson) {
  nsAutoCString type;
  if (!JsonExtractString(aJson, "type", type)) {
    fprintf(stderr, "[SPECULUM-CTRL-IGNORADO] (sem type)\n");
    return;
  }

  uint32_t id = 0;
  (void)JsonExtractUint(aJson, "id", &id);

  if (type.EqualsLiteral("ContextCreate")) {
    uint32_t contextId = 0;
    int32_t width = 0;
    int32_t height = 0;
    if (!JsonExtractUint(aJson, "contextId", &contextId) ||
        !JsonExtractInt(aJson, "width", &width) ||
        !JsonExtractInt(aJson, "height", &height)) {
      SendFault(id, "ContextCreate malformed");
      return;
    }
    HandleContextCreate(id, contextId, width, height);
    return;
  }

  if (type.EqualsLiteral("ContextDestroy")) {
    uint32_t contextId = 0;
    if (!JsonExtractUint(aJson, "contextId", &contextId)) {
      SendFault(id, "ContextDestroy malformed");
      return;
    }
    HandleContextDestroy(id, contextId);
    return;
  }

  fprintf(stderr, "[SPECULUM-CTRL-IGNORADO] %s\n", type.get());
}

void SpeculumDispatchControlPayload(const char* aJson, size_t aLength) {
  if (!aJson || aLength == 0) {
    return;
  }
  std::string json(aJson, aLength);
  NS_DispatchToMainThread(NS_NewRunnableFunction(
      "SpeculumHandleControl",
      [payload = std::move(json)]() { HandleControlJson(payload); }));
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
