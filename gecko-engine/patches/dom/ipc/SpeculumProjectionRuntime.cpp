/* Speculum — runtime de projeção no processo base (doc 17). */
#include "SpeculumProjectionRuntime.h"

#include "SpeculumAssetRegistry.h"
#include "SpeculumControlAbi.h"
#include "SpeculumLog.h"
#include "SpeculumMarionette.h"
#include "SpeculumTelemetry.h"
#include "mozilla/CondVar.h"
#include "mozilla/SystemPrincipal.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/CanonicalBrowsingContext.h"
#include "mozilla/dom/ContentParent.h"
#include "mozilla/dom/WindowGlobalParent.h"
#include "mozilla/ErrorResult.h"
#include "mozilla/Maybe.h"
#include "mozilla/Mutex.h"
#include "mozilla/NullPrincipal.h"
#include "mozilla/SpinEventLoopUntil.h"
#include "mozilla/StaticMutex.h"
#include "mozilla/TimeStamp.h"
#include "mozilla/UniquePtr.h"
#include "nsAppRunner.h"
#include "nsComponentManagerUtils.h"
#include "nsError.h"
#include "nsGlobalWindowOuter.h"
#include "nsIMutableArray.h"
#include "nsIURI.h"
#include "nsIBaseWindow.h"
#include "nsIDocShell.h"
#include "nsIDocShellTreeOwner.h"
#include "nsIWebNavigation.h"
#include "nsIWebProgress.h"
#include "nsIWebProgressListener.h"
#include "nsIWindowWatcher.h"
#include "nsIWindowMediator.h"
#include "nsIWindowMediatorListener.h"
#include "nsIAppWindow.h"
#include "nsISimpleEnumerator.h"
#include "nsIWidget.h"
#include "nsIInterfaceRequestorUtils.h"
#include "nsFocusManager.h"
#include "nsNetUtil.h"
#include "nsDocShellLoadState.h"
#include "nsDocShellLoadTypes.h"
#include "nsCOMPtr.h"
#include "nsIPrincipal.h"
#include "nsPIDOMWindow.h"
#include "nsPIDOMWindowInlines.h"
#include "nsString.h"
#include "nsSupportsPrimitives.h"
#include "nsThreadUtils.h"
#include "nsWeakReference.h"

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <map>
#include <set>
#include <string>
#include <vector>
#include <sys/socket.h>
#include <sys/un.h>
#include <thread>
#include <unistd.h>
#include <utility>

using mozilla::ErrorResult;
using mozilla::StaticMutex;
using mozilla::StaticMutexAutoLock;
using mozilla::SystemPrincipal;
using mozilla::UniquePtr;
using mozilla::MakeUnique;
using mozilla::dom::BrowsingContext;
using mozilla::dom::CanonicalBrowsingContext;
using mozilla::dom::ContentParent;
using mozilla::NullPrincipal;

namespace {

constexpr uint8_t kKindFrame = 0x01;
constexpr uint8_t kKindEvent = 0x02;
constexpr uint8_t kKindHello = 0x03;
constexpr uint8_t kKindCommand = 0x04;
constexpr uint8_t kKindTelemetry = 0x05;
constexpr uint8_t kKindAsset = 0x06;

// doc 18: LoadStateChanged.estado
constexpr uint8_t kLoadStateStart = 1;
constexpr uint8_t kLoadStateStop = 2;

void LogBridgeErr(const char* aMsg) {
  SPECULUM_LOG("[SPECULUM-RUNTIME-ERR] %s", aMsg);
}

[[noreturn]] void FatalRuntime(const char* aMsg) {
  fprintf(stderr, "[SPECULUM-RUNTIME-FATAL] %s\n", aMsg);
  _exit(1);
}

bool WriteAll(int aFd, const void* aData, size_t aLen) {
  const uint8_t* p = static_cast<const uint8_t*>(aData);
  size_t left = aLen;
  while (left > 0) {
    const ssize_t n = send(aFd, p, left, MSG_NOSIGNAL);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    if (n == 0) {
      return false;
    }
    p += static_cast<size_t>(n);
    left -= static_cast<size_t>(n);
  }
  return true;
}

// Lê exatamente aLen bytes, acumulando reads parciais (comportamento normal de
// socket stream). read()==0 é EOF; EINTR/EAGAIN não abortam.
bool ReadExactly(int aFd, void* aData, size_t aLen) {
  uint8_t* p = static_cast<uint8_t*>(aData);
  size_t left = aLen;
  while (left > 0) {
    const ssize_t n = recv(aFd, p, left, 0);
    if (n < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
        continue;
      }
      return false;
    }
    if (n == 0) {
      return false;
    }
    p += static_cast<size_t>(n);
    left -= static_cast<size_t>(n);
  }
  return true;
}

bool SendEnvelope(int aFd, uint8_t aKind, uint32_t aContextId,
                  const void* aPayload, uint32_t aLength) {
  uint8_t header[9];
  header[0] = aKind;
  header[1] = static_cast<uint8_t>(aContextId & 0xffu);
  header[2] = static_cast<uint8_t>((aContextId >> 8) & 0xffu);
  header[3] = static_cast<uint8_t>((aContextId >> 16) & 0xffu);
  header[4] = static_cast<uint8_t>((aContextId >> 24) & 0xffu);
  header[5] = static_cast<uint8_t>(aLength & 0xffu);
  header[6] = static_cast<uint8_t>((aLength >> 8) & 0xffu);
  header[7] = static_cast<uint8_t>((aLength >> 16) & 0xffu);
  header[8] = static_cast<uint8_t>((aLength >> 24) & 0xffu);
  if (!WriteAll(aFd, header, sizeof(header))) {
    return false;
  }
  if (aLength > 0 && aPayload) {
    if (!WriteAll(aFd, aPayload, aLength)) {
      return false;
    }
  }
  return true;
}

uint32_t ReadU32LE(const uint8_t* aBytes) {
  return static_cast<uint32_t>(aBytes[0]) |
         (static_cast<uint32_t>(aBytes[1]) << 8) |
         (static_cast<uint32_t>(aBytes[2]) << 16) |
         (static_cast<uint32_t>(aBytes[3]) << 24);
}

already_AddRefed<BrowsingContext> PrimaryContentTop(
    mozIDOMWindowProxy* aWindow) {
  nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(aWindow);
  if (!outer) {
    return nullptr;
  }
  nsIDocShell* chromeShell = outer->GetDocShell();
  if (!chromeShell) {
    return nullptr;
  }
  nsCOMPtr<nsIDocShellTreeOwner> treeOwner;
  chromeShell->GetTreeOwner(getter_AddRefs(treeOwner));
  if (!treeOwner) {
    return nullptr;
  }
  RefPtr<BrowsingContext> contentBc;
  treeOwner->GetPrimaryContentBrowsingContext(getter_AddRefs(contentBc));
  if (!contentBc) {
    return nullptr;
  }
  RefPtr<BrowsingContext> top = contentBc->Top();
  return top.forget();
}

// ---------------------------------------------------------------------------
// Lei (doc 03-embedder / 17-runtime): um processo ⇒ uma navigator:browser.
// Chamado no main thread ANTES do Ready. ContextCreate só associa a sessão.
// ---------------------------------------------------------------------------

uint64_t OuterWindowId(mozIDOMWindowProxy* aWindow) {
  nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(aWindow);
  return outer ? outer->WindowID() : 0;
}

already_AddRefed<mozIDOMWindowProxy> MostRecentNavigatorBrowser() {
  nsCOMPtr<nsIWindowMediator> wm = do_GetService(NS_WINDOWMEDIATOR_CONTRACTID);
  if (!wm) {
    return nullptr;
  }
  nsCOMPtr<mozIDOMWindowProxy> win;
  wm->GetMostRecentWindow(u"navigator:browser", getter_AddRefs(win));
  return win.forget();
}

uint32_t CountNavigatorBrowserWindows() {
  nsCOMPtr<nsIWindowMediator> wm = do_GetService(NS_WINDOWMEDIATOR_CONTRACTID);
  if (!wm) {
    return 0;
  }
  nsCOMPtr<nsISimpleEnumerator> en;
  if (NS_FAILED(wm->GetEnumerator(u"navigator:browser", getter_AddRefs(en))) ||
      !en) {
    return 0;
  }
  uint32_t n = 0;
  bool more = false;
  while (NS_SUCCEEDED(en->HasMoreElements(&more)) && more) {
    nsCOMPtr<nsISupports> supp;
    if (NS_FAILED(en->GetNext(getter_AddRefs(supp))) || !supp) {
      continue;
    }
    ++n;
  }
  return n;
}

void EnforceSoleNavigatorBrowser(mozIDOMWindowProxy* aKeep) {
  if (!aKeep) {
    return;
  }
  const uint64_t keepId = OuterWindowId(aKeep);
  nsCOMPtr<nsIWindowMediator> wm = do_GetService(NS_WINDOWMEDIATOR_CONTRACTID);
  if (!wm) {
    return;
  }
  nsCOMPtr<nsISimpleEnumerator> en;
  if (NS_FAILED(wm->GetEnumerator(u"navigator:browser", getter_AddRefs(en))) ||
      !en) {
    return;
  }

  std::vector<nsCOMPtr<mozIDOMWindowProxy>> extras;
  bool more = false;
  while (NS_SUCCEEDED(en->HasMoreElements(&more)) && more) {
    nsCOMPtr<nsISupports> supp;
    if (NS_FAILED(en->GetNext(getter_AddRefs(supp))) || !supp) {
      continue;
    }
    nsCOMPtr<mozIDOMWindowProxy> win = do_QueryInterface(supp);
    if (!win) {
      continue;
    }
    if (keepId != 0 && OuterWindowId(win) == keepId) {
      continue;
    }
    extras.push_back(win);
  }

  if (!extras.empty()) {
    SPECULUM_LOG(
        "[SPECULUM-CTX] enforce sole chrome keepId=%llu closing=%zu browsers=%u",
        static_cast<unsigned long long>(keepId), extras.size(),
        CountNavigatorBrowserWindows());
  }

  for (const auto& win : extras) {
    nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(win);
    if (!outer) {
      continue;
    }
    // Só ForceClose. Ele agenda FinalClose → ReallyCloseWindow → Destroy.
    // Destroy sync aqui = double-destroy / UAF (SIGSEGV 139).
    outer->ForceClose();
  }
}

// Raise pelo caminho do Gecko (nsFocusManager::RaiseWindow): Show + SizeMode
// + widget SetFocus(Raise::Yes). Sem isto o Virtual fica hidden e timers
// (Akamai) estrangulam. Nunca SetFocus em widget destruído / não realizado.
MOZ_CAN_RUN_SCRIPT_BOUNDARY void RaiseSpeculumBrowserChrome(
    mozIDOMWindowProxy* aWindow) {
  nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(aWindow);
  if (!outer) {
    return;
  }
  nsIDocShell* chromeShell = outer->GetDocShell();
  if (!chromeShell) {
    return;
  }
  // Mesmo QI que FocusManager::RaiseWindow — DocShell como nsIBaseWindow.
  nsCOMPtr<nsIBaseWindow> base = do_QueryInterface(chromeShell);
  if (!base) {
    nsCOMPtr<nsIDocShellTreeOwner> treeOwner;
    chromeShell->GetTreeOwner(getter_AddRefs(treeOwner));
    base = do_QueryInterface(treeOwner);
  }
  if (!base) {
    return;
  }
  (void)base->SetVisibility(true);
  (void)base->SetEnabled(true);

  nsCOMPtr<nsIWidget> widget;
  (void)base->GetMainWidget(getter_AddRefs(widget));
  if (!widget || widget->Destroyed()) {
    SPECULUM_LOG("[SPECULUM-CTX] raise skipped — no live widget winId=%llu",
                 static_cast<unsigned long long>(OuterWindowId(aWindow)));
    return;
  }
  if (widget->SizeMode() == nsSizeMode_Minimized) {
    widget->SetSizeMode(nsSizeMode_Normal);
  }
  widget->Show(true);

  if (RefPtr<nsFocusManager> fm = nsFocusManager::GetFocusManager()) {
    fm->RaiseWindow(outer, mozilla::dom::CallerType::System,
                    nsFocusManager::GenerateFocusActionId());
  }
}

void ResizeSpeculumBrowserChrome(mozIDOMWindowProxy* aWindow, int32_t aWidth,
                                 int32_t aHeight) {
  if (!aWindow || aWidth <= 0 || aHeight <= 0) {
    return;
  }
  nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(aWindow);
  if (!outer) {
    return;
  }
  nsIDocShell* chromeShell = outer->GetDocShell();
  if (!chromeShell) {
    return;
  }
  nsCOMPtr<nsIDocShellTreeOwner> treeOwner;
  chromeShell->GetTreeOwner(getter_AddRefs(treeOwner));
  nsCOMPtr<nsIBaseWindow> base = do_QueryInterface(treeOwner);
  if (!base) {
    return;
  }
  int32_t x = 0;
  int32_t y = 0;
  int32_t cx = 0;
  int32_t cy = 0;
  if (NS_FAILED(base->GetPositionAndSize(&x, &y, &cx, &cy))) {
    return;
  }
  (void)base->SetPositionAndSize(x, y, aWidth, aHeight, true);
}

// Abre a chrome da sessão (about:blank). Só quando o Firefox ainda não
// entregou nenhuma navigator:browser após a espera de boot.
nsresult CreateSoleBrowserChrome(int32_t aWidth, int32_t aHeight,
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
      do_CreateInstance(NS_SUPPORTS_PRBOOL_CONTRACTID);
  NS_ENSURE_TRUE(nsFalse, NS_ERROR_FAILURE);
  rv = nsFalse->SetData(false);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsISupportsPRUint32> userContextId =
      do_CreateInstance(NS_SUPPORTS_PRUINT32_CONTRACTID);
  NS_ENSURE_TRUE(userContextId, NS_ERROR_FAILURE);
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

// Boot (doc 03 / 17): exatamente uma navigator:browser antes do Ready.
//
// Algoritmo:
//  1. Se já há chrome (startup do Firefox): adotar a mais recente.
//  2. Se não há: criar about:blank.
//  3. Nunca OpenWindow quando já existe uma (segunda chrome = Beleza sem foco).
//  4. Fechar extras até browsers=1 (ForceClose é async — espera o settle).
//  5. Raise: documento visível (timers / antibot não estrangulam).
// Pós-Ready: SoleChromeGuard mantém o invariante se nascer chrome extra.
nsresult EnsureSoleSessionChrome(int32_t aWidth, int32_t aHeight,
                                 mozIDOMWindowProxy** aOutWindow,
                                 bool* aCreated) {
  *aOutWindow = nullptr;
  if (aCreated) {
    *aCreated = false;
  }

  nsCOMPtr<mozIDOMWindowProxy> win;
  bool created = false;
  if (CountNavigatorBrowserWindows() == 0) {
    nsresult rv = CreateSoleBrowserChrome(aWidth, aHeight, getter_AddRefs(win));
    if (NS_FAILED(rv) || !win) {
      return NS_FAILED(rv) ? rv : NS_ERROR_FAILURE;
    }
    created = true;
  } else {
    win = MostRecentNavigatorBrowser();
    if (!win) {
      return NS_ERROR_FAILURE;
    }
  }

  RefPtr<BrowsingContext> contentTop;
  const mozilla::TimeStamp contentDeadline =
      mozilla::TimeStamp::Now() + mozilla::TimeDuration::FromSeconds(15);
  (void)mozilla::SpinEventLoopUntil("SpeculumWaitSoleContent"_ns, [&]() {
    contentTop = PrimaryContentTop(win);
    return contentTop || mozilla::TimeStamp::Now() >= contentDeadline;
  });
  if (!contentTop) {
    SPECULUM_LOG(
        "[SPECULUM-CTX] no primary content created=%d browsers=%u",
        created ? 1 : 0, CountNavigatorBrowserWindows());
    return NS_ERROR_FAILURE;
  }

  EnforceSoleNavigatorBrowser(win);
  const mozilla::TimeStamp soleDeadline =
      mozilla::TimeStamp::Now() + mozilla::TimeDuration::FromSeconds(5);
  (void)mozilla::SpinEventLoopUntil("SpeculumWaitSoleCount"_ns, [&]() {
    if (CountNavigatorBrowserWindows() == 1) {
      return true;
    }
    EnforceSoleNavigatorBrowser(win);
    return mozilla::TimeStamp::Now() >= soleDeadline;
  });
  if (CountNavigatorBrowserWindows() != 1) {
    SPECULUM_LOG(
        "[SPECULUM-CTX] sole chrome failed browsers=%u keepId=%llu",
        CountNavigatorBrowserWindows(),
        static_cast<unsigned long long>(OuterWindowId(win)));
    return NS_ERROR_FAILURE;
  }

  ResizeSpeculumBrowserChrome(win, aWidth, aHeight);
  RaiseSpeculumBrowserChrome(win);

  if (aCreated) {
    *aCreated = created;
  }

  SPECULUM_LOG(
      "[SPECULUM-CTX] sole chrome winId=%llu created=%d browsers=%u",
      static_cast<unsigned long long>(OuterWindowId(win)), created ? 1 : 0,
      CountNavigatorBrowserWindows());

  win.forget(aOutWindow);
  return NS_OK;
}

}  // namespace

struct SpeculumProjectionRuntime::Impl {
  mozilla::Mutex mintMutex{"SpeculumMint"};
  uint32_t nextNestedContextId = 2;
  std::map<uint32_t, uint32_t> generations;

  uint32_t MintNestedContextId() {
    mozilla::MutexAutoLock lock(mintMutex);
    if (nextNestedContextId < 2) {
      nextNestedContextId = 2;
    }
    return nextNestedContextId++;
  }

  uint32_t ClaimGeneration(uint32_t aContextId) {
    mozilla::MutexAutoLock lock(mintMutex);
    return ++generations[aContextId];
  }

  StaticMutex projectedMutex;
  std::map<uint32_t, RefPtr<BrowsingContext>> contextToRootBc;
  std::map<uint64_t, uint32_t> bcIdToContextId;
  std::map<uint32_t, nsCOMPtr<mozIDOMWindowProxy>> contextToWindow;
  // Uma chrome por processo — preparada antes do Ready (doc 03 / 17).
  // ContextCreate só associa a sessão; não abre janela.
  nsCOMPtr<mozIDOMWindowProxy> soleChrome;
  // Fecha qualquer navigator:browser que nasça depois do Ready (startup tardio).
  nsCOMPtr<nsIWindowMediatorListener> soleChromeGuard;
  // HistoryGo do pai precisa de época > a que o SHIP tem, senão
  // sameEpoch=true e o passo some ("not in same doc").
  uint64_t nextHistoryEpoch = 1;

  class ProgressSink final : public nsIWebProgressListener,
                             public nsSupportsWeakReference {
   public:
    NS_DECL_ISUPPORTS
    NS_DECL_NSIWEBPROGRESSLISTENER

    ProgressSink(Impl* aImpl, uint32_t aContextId, uint64_t aBcId)
        : mImpl(aImpl), mContextId(aContextId), mBcId(aBcId) {}

    void WaitForCreated(uint32_t aCorrelationId) {
      mCreatedCorrelation = aCorrelationId;
      mWaitingCreated = true;
    }
    void WaitForNavigated(uint32_t aCorrelationId, const nsACString& aExpected) {
      mNavigatedCorrelation = aCorrelationId;
      mWaitingNavigated = true;
      mSawLoadStart = false;
      mSawExpectedLocation = false;
      mNavigateRetried = false;
      mExpectedSpec.Assign(aExpected);
    }
    void CancelWaitForNavigated() {
      mWaitingNavigated = false;
      mSawLoadStart = false;
      mSawExpectedLocation = false;
      mNavigateRetried = false;
      mExpectedSpec.Truncate();
    }
    bool IsWaitingNavigated() const { return mWaitingNavigated; }
    bool HasRetriedNavigate() const { return mNavigateRetried; }
    void MarkNavigateRetried() { mNavigateRetried = true; }
    const nsCString& ExpectedSpec() const { return mExpectedSpec; }
    void CompleteNavigatedFromLiveUri(const nsACString& aSpec) {
      if (!mWaitingNavigated) {
        return;
      }
      mSawExpectedLocation = true;
      mSawLoadStart = true;
      mLastLocation.Assign(aSpec);
      FinishNavigatedIfReady(aSpec, NS_OK);
    }
    void FinishNavigatedIfReady(const nsACString& aSpec, nsresult aStatus);
    void SetProgress(nsIWebProgress* aProgress) { mProgress = aProgress; }
    void DetachFromProgress() {
      if (mProgress) {
        (void)mProgress->RemoveProgressListener(this);
        mProgress = nullptr;
      }
      // Rebind troca o nsIWebProgress; não cancela WaitForNavigated /
      // WaitForCreated. CancelWaitForNavigated é o cancelamento explícito.
    }

   private:
    ~ProgressSink() { DetachFromProgress(); }

    Impl* mImpl;
    const uint32_t mContextId;
    const uint64_t mBcId;
    bool mWaitingCreated = false;
    bool mWaitingNavigated = false;
    bool mSawLoadStart = false;
    bool mSawExpectedLocation = false;
    bool mNavigateRetried = false;
    uint32_t mCreatedCorrelation = 0;
    uint32_t mNavigatedCorrelation = 0;
    nsCOMPtr<nsIWebProgress> mProgress;
    nsCString mLastLocation;
    nsCString mExpectedSpec;
    nsCString mLastCommittedSpec;
  };

  std::map<uint32_t, RefPtr<ProgressSink>> progressSinks;

  std::string socketPath;
  int fd = -1;
  mozilla::Mutex sendMutex{"SpeculumProjectionRuntime"};
  mozilla::CondVar sendCv{sendMutex, "SpeculumSendCv"};
  struct Outgoing {
    uint8_t kind = 0;
    uint32_t contextId = 0;
    nsTArray<uint8_t> payload;
    bool* done = nullptr;
    bool* ok = nullptr;
  };
  std::deque<Outgoing> controlQ;
  std::deque<Outgoing> dataQ;
  std::atomic<bool> stopRead{false};
  std::atomic<bool> stopWrite{false};
  std::thread readThread;
  std::thread writeThread;

  explicit Impl(std::string aPath) : socketPath(std::move(aPath)) {
    ConnectOrDie();
    SpeculumAssetRegistry::Get();
    writeThread = std::thread([this]() { WriteLoop(); });
    readThread = std::thread([this]() { ReadLoop(); });
  }

  ~Impl() {
    if (soleChromeGuard) {
      if (nsCOMPtr<nsIWindowMediator> wm =
              do_GetService(NS_WINDOWMEDIATOR_CONTRACTID)) {
        (void)wm->RemoveListener(soleChromeGuard);
      }
      soleChromeGuard = nullptr;
    }
    stopWrite = true;
    stopRead = true;
    {
      mozilla::MutexAutoLock lock(sendMutex);
      sendCv.NotifyAll();
      if (fd >= 0) {
        shutdown(fd, SHUT_RDWR);
      }
    }
    if (writeThread.joinable()) {
      writeThread.join();
    }
    if (readThread.joinable()) {
      readThread.join();
    }
    mozilla::MutexAutoLock lock(sendMutex);
    if (fd >= 0) {
      close(fd);
      fd = -1;
    }
  }

  void CloseFdUnlocked() {
    if (fd >= 0) {
      close(fd);
      fd = -1;
    }
  }

  [[noreturn]] void FailCataloguedImpl(uint32_t aContextId, const char* aCode,
                                       const char* aPhase, const char* aMsg) {
    SpeculumEmitProducerFault(aContextId, aCode, aPhase);
    FatalRuntime(aMsg);
  }

  void EnqueueUnlocked(uint8_t aKind, uint32_t aContextId, const uint8_t* aPayload,
                       uint32_t aLength, bool aControl, bool* aDone, bool* aOk) {
    Outgoing env;
    env.kind = aKind;
    env.contextId = aContextId;
    if (aLength && aPayload) {
      env.payload.AppendElements(aPayload, aLength);
    }
    env.done = aDone;
    env.ok = aOk;
    if (aControl) {
      controlQ.push_back(std::move(env));
    } else {
      dataQ.push_back(std::move(env));
    }
    sendCv.NotifyAll();
  }

  bool SendSync(uint8_t aKind, uint32_t aContextId, const uint8_t* aPayload,
                uint32_t aLength, bool aControl) {
    bool done = false;
    bool ok = false;
    {
      mozilla::MutexAutoLock lock(sendMutex);
      if (fd < 0) {
        return false;
      }
      EnqueueUnlocked(aKind, aContextId, aPayload, aLength, aControl, &done, &ok);
      while (!done) {
        sendCv.Wait();
      }
    }
    return ok;
  }

  void SendAsync(uint8_t aKind, uint32_t aContextId, const uint8_t* aPayload,
                 uint32_t aLength, bool aControl) {
    mozilla::MutexAutoLock lock(sendMutex);
    if (fd < 0) {
      return;
    }
    EnqueueUnlocked(aKind, aContextId, aPayload, aLength, aControl, nullptr,
                    nullptr);
  }

  void WriteLoop() {
    while (true) {
      Outgoing env;
      int sock = -1;
      {
        mozilla::MutexAutoLock lock(sendMutex);
        while (!stopWrite && controlQ.empty() && dataQ.empty()) {
          sendCv.Wait();
        }
        if (stopWrite && controlQ.empty() && dataQ.empty()) {
          return;
        }
        if (!controlQ.empty()) {
          env = std::move(controlQ.front());
          controlQ.pop_front();
        } else if (!dataQ.empty()) {
          env = std::move(dataQ.front());
          dataQ.pop_front();
        } else {
          continue;
        }
        sock = fd;
      }
      bool ok = false;
      if (sock >= 0) {
        ok = SendEnvelope(sock, env.kind, env.contextId, env.payload.Elements(),
                          env.payload.Length());
      }
      {
        mozilla::MutexAutoLock lock(sendMutex);
        if (!ok && fd >= 0) {
          CloseFdUnlocked();
        }
        if (env.ok) {
          *env.ok = ok;
        }
        if (env.done) {
          *env.done = true;
        }
        sendCv.NotifyAll();
      }
    }
  }

  void ConnectOrDie() {
    const int sock = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sock < 0) {
      FatalRuntime("socket create failed");
    }
    sockaddr_un addr {};
    if (socketPath.size() >= sizeof(addr.sun_path)) {
      close(sock);
      FatalRuntime("socket path too long");
    }
    addr.sun_family = AF_UNIX;
    memcpy(addr.sun_path, socketPath.c_str(), socketPath.size() + 1);
    if (connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
      close(sock);
      FatalRuntime("socket connect failed");
    }
    if (!SendEnvelope(sock, kKindHello, 0, nullptr, 0)) {
      close(sock);
      FatalRuntime("hello send failed");
    }
    // Hello na thread da ponte; Ready só no main thread DEPOIS da chrome única
    // existir. Senão o supervisor manda ContextCreate cedo e nasce a 2ª Nightly.
    fd = sock;
    SPECULUM_LOG("[SPECULUM-RUNTIME] ponte conectada em %s", socketPath.c_str());
    NS_DispatchToMainThread(NS_NewRunnableFunction(
        "SpeculumPrepareSoleChromeAndReady", [this]() {
          PrepareSoleChromeAndSendReady();
        }));
  }

  void EnforceAndRaiseSoleSessionChrome() {
    if (!soleChrome) {
      return;
    }
    EnforceSoleNavigatorBrowser(soleChrome);
    RaiseSpeculumBrowserChrome(soleChrome);
  }

  // Invariante pós-Ready (doc 17): uma navigator:browser pela vida do processo.
  // Qualquer chrome nova (UI do Firefox, _blank escapado) não é a sessão.
  class SoleChromeGuard final : public nsIWindowMediatorListener {
   public:
    NS_DECL_ISUPPORTS
    explicit SoleChromeGuard(Impl* aImpl) : mImpl(aImpl) {}

    NS_IMETHOD OnOpenWindow(nsIAppWindow* aWindow) override {
      if (!mImpl || !mImpl->soleChrome || !aWindow) {
        return NS_OK;
      }
      // Nunca ForceClose/Destroy DENTRO do OnOpenWindow — reentrância no
      // mediator. Fecha no tick seguinte; ForceClose já agenda o Destroy.
      nsCOMPtr<nsIDocShell> ds;
      if (NS_FAILED(aWindow->GetDocShell(getter_AddRefs(ds))) || !ds) {
        return NS_OK;
      }
      nsCOMPtr<nsPIDOMWindowOuter> outer = do_GetInterface(ds);
      if (!outer) {
        return NS_OK;
      }
      const uint64_t openedId = OuterWindowId(outer);
      const uint64_t keepId = OuterWindowId(mImpl->soleChrome);
      if (openedId == 0 || openedId == keepId) {
        return NS_OK;
      }
      SPECULUM_LOG(
          "[SPECULUM-CTX] extra chrome winId=%llu — defer ForceClose (keep=%llu)",
          static_cast<unsigned long long>(openedId),
          static_cast<unsigned long long>(keepId));
      Impl* impl = mImpl;
      nsCOMPtr<nsPIDOMWindowOuter> toClose = outer;
      NS_DispatchToMainThread(NS_NewRunnableFunction(
          "SpeculumCloseExtraChrome", [impl, toClose]() {
            if (toClose) {
              toClose->ForceClose();
            }
            if (impl) {
              impl->EnforceAndRaiseSoleSessionChrome();
            }
          }));
      return NS_OK;
    }

    NS_IMETHOD OnCloseWindow(nsIAppWindow*) override { return NS_OK; }

   private:
    ~SoleChromeGuard() = default;
    Impl* mImpl;
  };

  void InstallSoleChromeGuard() {
    if (soleChromeGuard) {
      return;
    }
    nsCOMPtr<nsIWindowMediator> wm = do_GetService(NS_WINDOWMEDIATOR_CONTRACTID);
    if (!wm) {
      return;
    }
    RefPtr<SoleChromeGuard> guard = new SoleChromeGuard(this);
    if (NS_SUCCEEDED(wm->AddListener(guard))) {
      soleChromeGuard = guard;
    }
  }

  void PrepareSoleChromeAndSendReady() {
    nsCOMPtr<mozIDOMWindowProxy> win;
    bool created = false;
    // Viewport provisório; ContextCreate aplica o tamanho da sessão.
    if (NS_FAILED(EnsureSoleSessionChrome(1280, 800, getter_AddRefs(win),
                                          &created)) ||
        !win) {
      FatalRuntime("sole chrome before Ready failed");
    }
    (void)created;
    soleChrome = win;
    InstallSoleChromeGuard();

    uint8_t readyPayload[kSpeculumControlHeaderBytes];
    SpeculumControlWriter readyWriter(
        readyPayload, sizeof(readyPayload), SpeculumControlOpCode::Ready, 0);
    if (!readyWriter.Ok()) {
      FatalRuntime("ready encode failed");
    }
    if (!SendEvent(readyPayload, static_cast<uint32_t>(readyWriter.Length()))) {
      FatalRuntime("ready send failed");
    }
    SPECULUM_LOG("[SPECULUM-RUNTIME] Ready — sole chrome winId=%llu browsers=%u",
                 static_cast<unsigned long long>(OuterWindowId(win)),
                 CountNavigatorBrowserWindows());
  }

  bool SendEvent(const uint8_t* aPayload, uint32_t aLength) {
    return SendSync(kKindEvent, 0, aPayload, aLength, /*aControl=*/true);
  }

  void SendFault(uint32_t aCorrelationId, uint32_t aContextId,
                 const char* aReason) {
    uint8_t buffer[512];
    SpeculumControlWriter writer(buffer, sizeof(buffer),
                                 SpeculumControlOpCode::Fault, aCorrelationId);
    if (!writer.WriteUInt32(aContextId) ||
        !writer.WriteString(nsDependentCString(aReason)) || !writer.Ok()) {
      LogBridgeErr("Fault encode failed");
      return;
    }
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
  }

  void SendContextCreated(uint32_t aCorrelationId, uint32_t aContextId,
                          uint64_t aBcId) {
    uint8_t buffer[64];
    SpeculumControlWriter writer(buffer, sizeof(buffer),
                                 SpeculumControlOpCode::ContextCreated,
                                 aCorrelationId);
    if (!writer.WriteUInt32(aContextId) || !writer.WriteUInt64(aBcId) ||
        !writer.WriteUInt32(0) || !writer.Ok()) {
      SendFault(aCorrelationId, aContextId, "ContextCreated encode failed");
      return;
    }
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
  }

  void SendNavigated(uint32_t aCorrelationId, uint32_t aContextId,
                     const nsACString& aUrl) {
    EnforceAndRaiseSoleSessionChrome();
    uint8_t buffer[4096];
    SpeculumControlWriter writer(buffer, sizeof(buffer),
                                 SpeculumControlOpCode::Navigated,
                                 aCorrelationId);
    if (!writer.WriteUInt32(aContextId) || !writer.WriteString(aUrl) ||
        !writer.Ok()) {
      SendFault(aCorrelationId, aContextId, "Navigated encode failed");
      return;
    }
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
  }

  void SendLoadState(uint32_t aContextId, uint8_t aState) {
    uint8_t buffer[32];
    SpeculumControlWriter writer(buffer, sizeof(buffer),
                                 SpeculumControlOpCode::LoadStateChanged, 0);
    if (!writer.WriteUInt32(aContextId) || !writer.WriteUInt8(aState) ||
        !writer.Ok()) {
      return;
    }
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
  }

  bool AttachProgressSink(BrowsingContext* aBc, uint32_t aContextId,
                          uint64_t aBcId, ProgressSink** aOut) {
    if (!aBc || !aOut) {
      return false;
    }
    CanonicalBrowsingContext* canonical = aBc->Canonical();
    if (!canonical) {
      return false;
    }
    nsIWebProgress* progress = canonical->GetWebProgress();
    if (!progress) {
      return false;
    }
    RefPtr<ProgressSink> sink = new ProgressSink(this, aContextId, aBcId);
    nsresult rv = progress->AddProgressListener(
        sink, nsIWebProgress::NOTIFY_STATE_WINDOW |
                  nsIWebProgress::NOTIFY_STATE_NETWORK |
                  nsIWebProgress::NOTIFY_LOCATION);
    if (NS_FAILED(rv)) {
      return false;
    }
    sink->SetProgress(progress);
    progressSinks[aContextId] = sink;
    sink.forget(aOut);
    return true;
  }

  void DetachProgressSink(uint32_t aContextId) {
    const auto found = progressSinks.find(aContextId);
    if (found == progressSinks.end()) {
      return;
    }
    found->second->DetachFromProgress();
    progressSinks.erase(found);
  }

  void RebindProgressSink(uint32_t aContextId, BrowsingContext* aLive) {
    if (!aLive) {
      return;
    }
    CanonicalBrowsingContext* canonical = aLive->Canonical();
    if (!canonical) {
      return;
    }
    nsIWebProgress* progress = canonical->GetWebProgress();
    if (!progress) {
      return;
    }
    const auto found = progressSinks.find(aContextId);
    if (found == progressSinks.end()) {
      return;
    }
    found->second->DetachFromProgress();
    nsresult rv = progress->AddProgressListener(
        found->second, nsIWebProgress::NOTIFY_STATE_WINDOW |
                           nsIWebProgress::NOTIFY_STATE_NETWORK |
                           nsIWebProgress::NOTIFY_LOCATION);
    if (NS_FAILED(rv)) {
      return;
    }
    found->second->SetProgress(progress);
  }

  // A aba troca de BrowsingContext (bfcache, remoteness, COOP). O campo
  // SpeculumContextId vai no ReplacedBy; o ponteiro que o runtime guarda
  // precisa acompanhar, senão o Navigate seguinte fala com a aba velha.
  void AdoptLiveRootBc(uint32_t aContextId, BrowsingContext* aLive) {
    if (!aLive) {
      return;
    }
    bool remapped = false;
    {
      StaticMutexAutoLock lock(projectedMutex);
      const auto found = contextToRootBc.find(aContextId);
      if (found == contextToRootBc.end()) {
        return;
      }
      if (found->second != aLive) {
        const uint64_t oldId = found->second->Id();
        const uint64_t newId = aLive->Id();
        found->second = aLive;
        bcIdToContextId.erase(oldId);
        bcIdToContextId[newId] = aContextId;
        SPECULUM_LOG("[SPECULUM-BC] remap ctx=%u oldBc=%llu newBc=%llu",
                     aContextId, static_cast<unsigned long long>(oldId),
                     static_cast<unsigned long long>(newId));
        remapped = true;
      }
    }
    // O mesmo WebProgress não precisa rebind. Rebind no meio do Navigate
    // matava WaitForNavigated (Detach limpava o wait) e o Navigated nunca saía.
    if (remapped) {
      RebindProgressSink(aContextId, aLive);
      // Process switch / COOP: o LOCATION pode ter caído no WebProgress velho.
      // Se a URI viva já é real, fecha o Navigated sem esperar outro evento.
      TryCompleteNavigatedFromLiveUri(aContextId, aLive);
    }
  }

  void TryCompleteNavigatedFromLiveUri(uint32_t aContextId,
                                       BrowsingContext* aLive) {
    if (!aLive) {
      return;
    }
    const auto found = progressSinks.find(aContextId);
    if (found == progressSinks.end() || !found->second) {
      return;
    }
    ProgressSink* sink = found->second;
    if (!sink->IsWaitingNavigated()) {
      return;
    }
    CanonicalBrowsingContext* canonical = aLive->Canonical();
    if (!canonical) {
      return;
    }
    nsCOMPtr<nsIURI> uri = canonical->GetCurrentURI();
    if (!uri) {
      return;
    }
    nsAutoCString spec;
    if (NS_FAILED(uri->GetSpec(spec)) || spec.IsEmpty() ||
        spec.EqualsLiteral("about:blank")) {
      return;
    }
    SPECULUM_LOG("[SPECULUM-CTRL] Navigated via live URI after remap ctx=%u url=%s",
                 aContextId, spec.get());
    sink->CompleteNavigatedFromLiveUri(spec);
  }

  already_AddRefed<BrowsingContext> ResolveLiveRoot(uint32_t aContextId) {
    nsCOMPtr<mozIDOMWindowProxy> window;
    RefPtr<BrowsingContext> stored;
    {
      StaticMutexAutoLock lock(projectedMutex);
      const auto found = contextToRootBc.find(aContextId);
      if (found == contextToRootBc.end()) {
        return nullptr;
      }
      stored = found->second;
      const auto winIt = contextToWindow.find(aContextId);
      if (winIt != contextToWindow.end()) {
        window = winIt->second;
      }
    }
    // SHIP troca o objeto BC da aba. O treeOwner chrome fica com o velho
    // (IsReplaced). GetCurrentTopByBrowserId é o topo vivo desse browserId.
    RefPtr<BrowsingContext> live;
    if (stored) {
      live = BrowsingContext::GetCurrentTopByBrowserId(stored->BrowserId());
    }
    if (!live) {
      live = PrimaryContentTop(window);
    }
    if (live && live != stored) {
      AdoptLiveRootBc(aContextId, live);
      return live.forget();
    }
    return stored.forget();
  }

  void HandleContextCreate(uint32_t aCorrelationId, uint32_t aContextId,
                           int32_t aWidth, int32_t aHeight) {
    {
      StaticMutexAutoLock lock(projectedMutex);
      if (contextToRootBc.find(aContextId) != contextToRootBc.end()) {
        SendFault(aCorrelationId, aContextId, "contextId already registered");
        return;
      }
    }

    // Ready já deixou exatamente uma chrome. Associa a sessão + foco.
    nsCOMPtr<mozIDOMWindowProxy> window = soleChrome;
    if (!window) {
      SendFault(aCorrelationId, aContextId, "sole chrome missing after Ready");
      return;
    }
    ResizeSpeculumBrowserChrome(window, aWidth, aHeight);
    EnforceAndRaiseSoleSessionChrome();

    nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(window);
    if (!outer) {
      SendFault(aCorrelationId, aContextId, "no outer window");
      return;
    }

    nsIDocShell* chromeShell = outer->GetDocShell();
    if (!chromeShell) {
      SendFault(aCorrelationId, aContextId, "no chrome docshell");
      return;
    }
    nsCOMPtr<nsIDocShellTreeOwner> treeOwner;
    chromeShell->GetTreeOwner(getter_AddRefs(treeOwner));
    if (!treeOwner) {
      SendFault(aCorrelationId, aContextId, "no tree owner");
      return;
    }

    RefPtr<BrowsingContext> chromeBc = outer->GetBrowsingContext();
    RefPtr<BrowsingContext> contentBc;
    treeOwner->GetPrimaryContentBrowsingContext(getter_AddRefs(contentBc));
    if (!contentBc) {
      SendFault(aCorrelationId, aContextId, "no primary content browsing context");
      return;
    }

    SPECULUM_LOG(
        "[SPECULUM-CTX] ctx=%u chromeBc=%llu contentBc=%llu browsers=%u",
        aContextId,
        static_cast<unsigned long long>(chromeBc ? chromeBc->Id() : 0),
        static_cast<unsigned long long>(contentBc->Id()),
        CountNavigatorBrowserWindows());

    RefPtr<BrowsingContext> bc = contentBc->Top();
    if (!bc) {
      SendFault(aCorrelationId, aContextId, "no top content browsing context");
      return;
    }

    const uint64_t bcId = bc->Id();

    {
      StaticMutexAutoLock lock(projectedMutex);
      // Recheca: outro ContextCreate pode ter corrido enquanto o event loop girava.
      if (contextToRootBc.find(aContextId) != contextToRootBc.end()) {
        SendFault(aCorrelationId, aContextId, "contextId already registered");
        return;
      }
      if (bcIdToContextId.find(bcId) != bcIdToContextId.end()) {
        SendFault(aCorrelationId, aContextId,
                  "browsing context already registered");
        return;
      }
      contextToRootBc.emplace(aContextId, bc);
      bcIdToContextId.emplace(bcId, aContextId);
      contextToWindow.emplace(aContextId, window);
    }

    // Commit do campo sincronizado faz IPC para o grupo. Fora do lock, pelo
    // mesmo motivo da espera da content BC.
    if (NS_FAILED(bc->SetSpeculumContextId(aContextId))) {
      StaticMutexAutoLock lock(projectedMutex);
      contextToRootBc.erase(aContextId);
      bcIdToContextId.erase(bcId);
      contextToWindow.erase(aContextId);
      SendFault(aCorrelationId, aContextId, "SetSpeculumContextId failed");
      return;
    }

    RefPtr<ProgressSink> sink;
    if (!AttachProgressSink(bc, aContextId, bcId, getter_AddRefs(sink))) {
      (void)bc->SetSpeculumContextId(0);
      StaticMutexAutoLock lock(projectedMutex);
      contextToRootBc.erase(aContextId);
      bcIdToContextId.erase(bcId);
      contextToWindow.erase(aContextId);
      SendFault(aCorrelationId, aContextId, "progress listener failed");
      return;
    }

    // ContextCreated só quando a aba está quieta. Senão o Navigate seguinte
    // compete com o load de inicialização e o ack otimista mente.
    if (bc->IsLoading()) {
      sink->WaitForCreated(aCorrelationId);
    } else {
      SendContextCreated(aCorrelationId, aContextId, bcId);
    }
  }

  void HandleContextDestroy(uint32_t aCorrelationId, uint32_t aContextId) {
    RefPtr<BrowsingContext> bc;
    nsCOMPtr<mozIDOMWindowProxy> window;
    uint64_t bcId = 0;

    {
      StaticMutexAutoLock lock(projectedMutex);
      const auto found = contextToRootBc.find(aContextId);
      if (found == contextToRootBc.end()) {
        SendFault(aCorrelationId, aContextId, "unknown contextId");
        return;
      }
      bc = found->second;
      bcId = bc->Id();
      const auto winIt = contextToWindow.find(aContextId);
      if (winIt != contextToWindow.end()) {
        window = winIt->second;
      }
      contextToRootBc.erase(found);
      bcIdToContextId.erase(bcId);
      contextToWindow.erase(aContextId);
    }

    DetachProgressSink(aContextId);

    if (bc && !bc->IsDiscarded()) {
      (void)bc->SetSpeculumContextId(0);
    }

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
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
  }

  void HandleNavigate(uint32_t aCorrelationId, uint32_t aContextId,
                      const nsACString& aUrl) {
    RefPtr<BrowsingContext> bc = ResolveLiveRoot(aContextId);
    if (!bc) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }

    if (bc->IsDiscarded()) {
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

    CanonicalBrowsingContext* canonical = bc->Canonical();
    if (!canonical) {
      SendFault(aCorrelationId, aContextId, "no canonical browsing context");
      return;
    }
    if (canonical->IsReplaced()) {
      SendFault(aCorrelationId, aContextId, "browsing context replaced");
      return;
    }
    if (!canonical->GetContentParent() && !canonical->GetDocShell()) {
      SendFault(aCorrelationId, aContextId, "no content process");
      return;
    }
    RebindProgressSink(aContextId, bc);
    (void)bc->RemoveRootFromBFCacheSync();

    const auto foundSink = progressSinks.find(aContextId);
    if (foundSink == progressSinks.end()) {
      SendFault(aCorrelationId, aContextId, "no progress listener");
      return;
    }
    // Armar ANTES do LoadURI: o START pode chegar síncrono. Sem isto o STOP
    // da carga anterior (about:blank, página velha) vira Navigated falso.
    foundSink->second->WaitForNavigated(aCorrelationId, spec);

    // LoadURI no pai, sem documento-fonte. Navigate() usa a janela incumbente
    // (chrome) como origem e, depois de HistoryGo, CanNavigate/SendLoadURI
    // por esse caminho some em silêncio — sem START, sem alert, sem pedido.
    RefPtr<nsDocShellLoadState> loadState = new nsDocShellLoadState(uri);
    RefPtr<nsIPrincipal> systemPrincipal = SystemPrincipal::Get();
    loadState->SetTriggeringPrincipal(systemPrincipal);
    loadState->SetFirstParty(true);
    loadState->SetLoadType(LOAD_STOP_CONTENT);
    loadState->SetLoadFlags(nsIWebNavigation::LOAD_FLAGS_NONE);
    SPECULUM_LOG("[SPECULUM-CTRL] LoadURI ctx=%u bc=%llu cp=%p replaced=%d",
                 aContextId, static_cast<unsigned long long>(canonical->Id()),
                 canonical->GetContentParent(), int(canonical->IsReplaced()));
    rv = bc->LoadURI(loadState);
    EnforceAndRaiseSoleSessionChrome();
    if (NS_FAILED(rv)) {
      foundSink->second->CancelWaitForNavigated();
      SendFault(aCorrelationId, aContextId, "navigate failed");
    }
  }

  // LOAD_STOP_CONTENT aborta o about:blank (STOP aborted). Em alguns HTTPS
  // (Beleza) o LoadURI seguinte não emite START — URI fica blank e Navigated
  // nunca fecha. Uma retentativa com LOAD_NORMAL destrava o caminho desenhado.
  void RetryLoadURIAfterAbort(uint32_t aContextId) {
    const auto foundSink = progressSinks.find(aContextId);
    if (foundSink == progressSinks.end() || !foundSink->second) {
      return;
    }
    ProgressSink* sink = foundSink->second;
    if (!sink->IsWaitingNavigated() || sink->HasRetriedNavigate()) {
      return;
    }
    if (sink->ExpectedSpec().IsEmpty() ||
        sink->ExpectedSpec().EqualsLiteral("about:blank")) {
      return;
    }

    RefPtr<BrowsingContext> bc = ResolveLiveRoot(aContextId);
    if (!bc || bc->IsDiscarded() || !bc->IsTargetable()) {
      return;
    }
    CanonicalBrowsingContext* canonical = bc->Canonical();
    if (!canonical || canonical->IsReplaced()) {
      return;
    }

    nsCOMPtr<nsIURI> uri;
    if (NS_FAILED(NS_NewURI(getter_AddRefs(uri), sink->ExpectedSpec())) || !uri) {
      return;
    }

    sink->MarkNavigateRetried();
    RebindProgressSink(aContextId, bc);

    RefPtr<nsDocShellLoadState> loadState = new nsDocShellLoadState(uri);
    RefPtr<nsIPrincipal> systemPrincipal = SystemPrincipal::Get();
    loadState->SetTriggeringPrincipal(systemPrincipal);
    loadState->SetFirstParty(true);
    loadState->SetLoadType(LOAD_NORMAL);
    loadState->SetLoadFlags(nsIWebNavigation::LOAD_FLAGS_NONE);
    SPECULUM_LOG("[SPECULUM-CTRL] retry LoadURI after abort ctx=%u url=%s",
                 aContextId, sink->ExpectedSpec().get());
    (void)bc->LoadURI(loadState);
  }

  BrowsingContext* FindBySpeculumContextId(BrowsingContext* aRoot,
                                           uint32_t aContextId) {
    if (!aRoot) {
      return nullptr;
    }
    if (aRoot->GetSpeculumContextId() == aContextId) {
      return aRoot;
    }
    for (BrowsingContext* child : aRoot->Children()) {
      if (BrowsingContext* found =
              FindBySpeculumContextId(child, aContextId)) {
        return found;
      }
    }
    return nullptr;
  }

  already_AddRefed<BrowsingContext> ResolveProjected(uint32_t aContextId) {
    RefPtr<BrowsingContext> direct = ResolveLiveRoot(aContextId);
    if (direct) {
      return direct.forget();
    }

    std::vector<uint32_t> roots;
    {
      StaticMutexAutoLock lock(projectedMutex);
      roots.reserve(contextToRootBc.size());
      for (const auto& kv : contextToRootBc) {
        roots.push_back(kv.first);
      }
    }
    for (uint32_t rootId : roots) {
      RefPtr<BrowsingContext> root = ResolveLiveRoot(rootId);
      if (!root) {
        continue;
      }
      if (BrowsingContext* found = FindBySpeculumContextId(root, aContextId)) {
        RefPtr<BrowsingContext> keep = found;
        return keep.forget();
      }
    }
    return nullptr;
  }

  already_AddRefed<nsIPrincipal> DocumentPrincipalOf(uint32_t aContextId) {
    RefPtr<BrowsingContext> bc = ResolveProjected(aContextId);
    if (!bc || bc->IsDiscarded()) {
      return nullptr;
    }
    CanonicalBrowsingContext* canonical = bc->Canonical();
    if (!canonical) {
      return nullptr;
    }
    if (mozilla::dom::WindowGlobalParent* wgp =
            canonical->GetCurrentWindowGlobal()) {
      nsCOMPtr<nsIPrincipal> principal = wgp->DocumentPrincipal();
      return principal.forget();
    }
    return nullptr;
  }

  void HandleResync(uint32_t aCorrelationId, uint32_t aContextId,
                    uint8_t aForce) {
    if (aForce > 1) {
      SendFault(aCorrelationId, aContextId, "invalid resync force");
      return;
    }

    RefPtr<BrowsingContext> bc = ResolveProjected(aContextId);
    if (!bc || bc->IsDiscarded()) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }

    CanonicalBrowsingContext* canonical = bc->Canonical();
    if (!canonical) {
      SendFault(aCorrelationId, aContextId, "no canonical browsing context");
      return;
    }

    ContentParent* cp = canonical->GetContentParent();
    if (!cp) {
      SendFault(aCorrelationId, aContextId, "no content process");
      return;
    }

    if (!cp->SendSpeculumResync(aContextId, aForce)) {
      SendFault(aCorrelationId, aContextId, "SpeculumResync send failed");
    }
  }

  ContentParent* ContentParentOf(uint32_t aContextId) {
    RefPtr<BrowsingContext> bc = ResolveProjected(aContextId);
    if (!bc || bc->IsDiscarded()) {
      return nullptr;
    }
    CanonicalBrowsingContext* canonical = bc->Canonical();
    if (!canonical) {
      return nullptr;
    }
    return canonical->GetContentParent();
  }

  std::set<uint32_t> nestedHostPublished;
  std::set<uint32_t> nestedEmitAllowedSent;

  void TryAllowNested(uint32_t aContextId) {
    if (aContextId < 2) {
      return;
    }
    if (nestedEmitAllowedSent.count(aContextId)) {
      return;
    }
    if (!nestedHostPublished.count(aContextId)) {
      return;
    }
    ContentParent* cp = ContentParentOf(aContextId);
    if (!cp) {
      SPECULUM_LOG("[SPECULUM-NESTED] allow wait no-cp ctx=%u", aContextId);
      return;
    }
    if (!cp->SendSpeculumNestedEmitAllow(aContextId)) {
      SPECULUM_LOG("[SPECULUM-NESTED] allow send failed ctx=%u", aContextId);
      return;
    }
    nestedEmitAllowedSent.insert(aContextId);
    SPECULUM_LOG("[SPECULUM-NESTED] allow sent ctx=%u", aContextId);
  }

  void NotePublishedNested(const nsTArray<uint32_t>& aChildContextIds) {
    for (uint32_t childId : aChildContextIds) {
      if (childId < 2) {
        continue;
      }
      nestedHostPublished.insert(childId);
      TryAllowNested(childId);
    }
  }

  void NoteNestedStandby(uint32_t aContextId) {
    SPECULUM_LOG("[SPECULUM-NESTED] standby recv ctx=%u", aContextId);
    TryAllowNested(aContextId);
  }

  void HandleHaltClocks() {
    std::vector<uint32_t> roots;
    {
      StaticMutexAutoLock lock(projectedMutex);
      for (const auto& kv : contextToRootBc) {
        roots.push_back(kv.first);
      }
    }
    for (uint32_t rootId : roots) {
      if (ContentParent* cp = ContentParentOf(rootId)) {
        (void)cp->SendSpeculumHaltClocks();
      }
    }
  }

  void HandleResumeClocks() {
    std::vector<uint32_t> roots;
    {
      StaticMutexAutoLock lock(projectedMutex);
      for (const auto& kv : contextToRootBc) {
        roots.push_back(kv.first);
      }
    }
    for (uint32_t rootId : roots) {
      if (ContentParent* cp = ContentParentOf(rootId)) {
        (void)cp->SendSpeculumResumeClocks();
      }
    }
  }

  void HandleFlushFrame(uint32_t aCorrelationId, uint32_t aContextId) {
    ContentParent* cp = ContentParentOf(aContextId);
    if (!cp) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    if (!cp->SendSpeculumFlushFrame(aContextId)) {
      SendFault(aCorrelationId, aContextId, "FlushFrame send failed");
    }
  }

  void HandleSnapshot(uint32_t aCorrelationId, uint32_t aContextId) {
    ContentParent* cp = ContentParentOf(aContextId);
    if (!cp) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    if (!cp->SendSpeculumSnapshot(aContextId, aCorrelationId)) {
      SendFault(aCorrelationId, aContextId, "Snapshot send failed");
    }
  }

  void HandleInput(uint32_t aCorrelationId, uint32_t aContextId,
                   nsTArray<uint8_t>&& aEvent) {
    ContentParent* cp = ContentParentOf(aContextId);
    if (!cp) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    if (!cp->SendSpeculumInput(aContextId, aEvent)) {
      SendFault(aCorrelationId, aContextId, "Input send failed");
    }
  }

  void HandleDialogRespond(uint32_t aCorrelationId, uint32_t aContextId,
                           uint32_t aRequestId, const nsACString& aAnswer) {
    SpeculumCompleteDialog(aContextId, aRequestId, aAnswer);
    ContentParent* cp = ContentParentOf(aContextId);
    if (!cp) {
      return;
    }
    if (!cp->SendSpeculumDialogRespond(aContextId, aRequestId, aAnswer)) {
      SendFault(aCorrelationId, aContextId, "DialogRespond send failed");
    }
  }

  void HandleViewportSet(uint32_t aCorrelationId, uint32_t aContextId,
                         int32_t aWidth, int32_t aHeight) {
    nsCOMPtr<mozIDOMWindowProxy> window;
    {
      StaticMutexAutoLock lock(projectedMutex);
      const auto found = contextToWindow.find(aContextId);
      if (found == contextToWindow.end()) {
        SendFault(aCorrelationId, aContextId, "unknown contextId");
        return;
      }
      window = found->second;
    }
    nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(window);
    if (!outer) {
      SendFault(aCorrelationId, aContextId, "no outer window");
      return;
    }
    nsIDocShell* chromeShell = outer->GetDocShell();
    if (!chromeShell) {
      SendFault(aCorrelationId, aContextId, "no chrome docshell");
      return;
    }
    nsCOMPtr<nsIDocShellTreeOwner> treeOwner;
    chromeShell->GetTreeOwner(getter_AddRefs(treeOwner));
    nsCOMPtr<nsIBaseWindow> base = do_QueryInterface(treeOwner);
    if (!base) {
      SendFault(aCorrelationId, aContextId, "no base window");
      return;
    }
    int32_t x = 0;
    int32_t y = 0;
    int32_t cx = 0;
    int32_t cy = 0;
    if (NS_FAILED(base->GetPositionAndSize(&x, &y, &cx, &cy))) {
      SendFault(aCorrelationId, aContextId, "GetPositionAndSize failed");
      return;
    }
    if (NS_FAILED(base->SetPositionAndSize(x, y, aWidth, aHeight, true))) {
      SendFault(aCorrelationId, aContextId, "SetPositionAndSize failed");
    }
  }

  MOZ_CAN_RUN_SCRIPT_BOUNDARY
  void HandleHistoryGo(uint32_t aCorrelationId, uint32_t aContextId,
                       int32_t aDelta) {
    RefPtr<BrowsingContext> bc = ResolveLiveRoot(aContextId);
    if (!bc || bc->IsDiscarded()) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    RefPtr<CanonicalBrowsingContext> canonical = bc->Canonical();
    if (!canonical) {
      SendFault(aCorrelationId, aContextId, "no canonical browsing context");
      return;
    }
    if (aDelta == 0) {
      return;
    }
    // SHIP aplica o passo no pai. GoBack() no Canonical só mexe no
    // nsDocShell in-process (chrome) ou manda RecvGoBack ao filho — se os
    // dois forem null, some em silêncio e o cliente fica na página nova.
    SPECULUM_LOG("[SPECULUM-CTRL] HistoryGo ctx=%u delta=%d bc=%llu",
                 aContextId, aDelta,
                 static_cast<unsigned long long>(canonical->Id()));
    const mozilla::Maybe<int32_t> index = canonical->HistoryGo(
        aDelta, nextHistoryEpoch++, /*aRequireUserInteraction*/ false,
        /*aUserActivation*/ true, /*aCheckForCancelation*/ false,
        mozilla::Nothing(), [](nsresult) {});
    if (index.isNothing()) {
      SendFault(aCorrelationId, aContextId, "history go failed");
    }
  }

  void HandleReload(uint32_t aCorrelationId, uint32_t aContextId) {
    RefPtr<BrowsingContext> bc = ResolveLiveRoot(aContextId);
    if (!bc || bc->IsDiscarded()) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    CanonicalBrowsingContext* canonical = bc->Canonical();
    if (!canonical) {
      SendFault(aCorrelationId, aContextId, "no canonical browsing context");
      return;
    }
    canonical->Reload(nsIWebNavigation::LOAD_FLAGS_NONE);
  }

  void HandleStop(uint32_t aCorrelationId, uint32_t aContextId) {
    RefPtr<BrowsingContext> bc = ResolveLiveRoot(aContextId);
    if (!bc || bc->IsDiscarded()) {
      SendFault(aCorrelationId, aContextId, "unknown contextId");
      return;
    }
    CanonicalBrowsingContext* canonical = bc->Canonical();
    if (!canonical) {
      SendFault(aCorrelationId, aContextId, "no canonical browsing context");
      return;
    }
    canonical->Stop(nsIWebNavigation::STOP_ALL);
  }

  void SendRequested(SpeculumControlOpCode aOp, uint32_t aContextId,
                     uint32_t aRequestId, const nsACString& aDescription) {
    const size_t cap = 64 + aDescription.Length();
    auto buffer = MakeUnique<uint8_t[]>(cap);
    SpeculumControlWriter writer(buffer.get(), cap, aOp, 0);
    if (!writer.WriteUInt32(aContextId) || !writer.WriteUInt32(aRequestId) ||
        !writer.WriteBytes(aDescription) || !writer.Ok()) {
      return;
    }
    SendEvent(buffer.get(), static_cast<uint32_t>(writer.Length()));
  }

  bool SendAssetEnvelope(uint32_t aContextId, const uint8_t* aPayload,
                         uint32_t aLength) {
    SendAsync(kKindAsset, aContextId, aPayload, aLength, /*aControl=*/false);
    return true;
  }

  bool SendTelemetryEnvelope(uint32_t aContextId, const uint8_t* aPayload,
                             uint32_t aLength) {
    SendAsync(kKindTelemetry, aContextId, aPayload, aLength, /*aControl=*/true);
    return true;
  }

  void HandleAssetPayload(uint32_t aContextId, const uint8_t* aPayload,
                          size_t aLength) {
    SpeculumAssetRegistry::Get().OnConsumerRequest(
        aContextId, aPayload, aLength,
        [this](uint32_t ctx, const uint8_t* p, uint32_t n) {
          SendAssetEnvelope(ctx, p, n);
        });
  }

  void DeliverSnapshot(uint32_t aContextId, uint32_t aCorrelationId,
                       uint32_t aSequence, uint32_t aGeneration,
                       uint64_t aTableHash, nsTArray<uint8_t>& aDump) {
    const size_t cap = 64 + aDump.Length();
    auto buffer = MakeUnique<uint8_t[]>(cap);
    SpeculumControlWriter writer(buffer.get(), cap,
                                 SpeculumControlOpCode::SnapshotServed,
                                 aCorrelationId);
    nsDependentCString dump(
        reinterpret_cast<const char*>(aDump.Elements()), aDump.Length());
    if (!writer.WriteUInt32(aSequence) || !writer.WriteUInt32(aGeneration) ||
        !writer.WriteUInt32(aContextId) || !writer.WriteUInt64(aTableHash) ||
        !writer.WriteBytes(dump) || !writer.Ok()) {
      SendFault(aCorrelationId, aContextId, "response_too_large");
      return;
    }
    SendEvent(buffer.get(), static_cast<uint32_t>(writer.Length()));
  }

  void HandleControlBinary(const uint8_t* aData, size_t aLength) {
    SpeculumControlReader reader(aData, aLength);
    if (!reader.Ok()) {
      SPECULUM_LOG("[SPECULUM-CTRL-ERR] mensagem truncada (cabecalho)");
      return;
    }

    const uint16_t op = reader.OpCode();
    const uint32_t correlationId = reader.CorrelationId();
    SPECULUM_LOG("[SPECULUM-CTRL] opcode=0x%04x correlationId=%u", op,
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
      case SpeculumControlOpCode::Resync: {
        uint32_t contextId = 0;
        uint8_t force = 0;
        if (!reader.ReadUInt32(&contextId) || !reader.ReadUInt8(&force)) {
          SendFault(correlationId, 0, "Resync truncated");
          return;
        }
        HandleResync(correlationId, contextId, force);
        return;
      }
      case SpeculumControlOpCode::HaltClocks:
        HandleHaltClocks();
        return;
      case SpeculumControlOpCode::ResumeClocks:
        HandleResumeClocks();
        return;
      case SpeculumControlOpCode::FlushFrame: {
        uint32_t contextId = 0;
        if (!reader.ReadUInt32(&contextId)) {
          SendFault(correlationId, 0, "FlushFrame truncated");
          return;
        }
        HandleFlushFrame(correlationId, contextId);
        return;
      }
      case SpeculumControlOpCode::Snapshot: {
        uint32_t contextId = 0;
        if (!reader.ReadUInt32(&contextId)) {
          SendFault(correlationId, 0, "Snapshot truncated");
          return;
        }
        HandleSnapshot(correlationId, contextId);
        return;
      }
      case SpeculumControlOpCode::Input: {
        uint32_t contextId = 0;
        if (!reader.ReadUInt32(&contextId)) {
          SendFault(correlationId, 0, "Input truncated");
          return;
        }
        nsTArray<uint8_t> bytes;
        if (reader.Remaining() > 0) {
          bytes.AppendElements(reader.RemainingData(), reader.Remaining());
        }
        HandleInput(correlationId, contextId, std::move(bytes));
        return;
      }
      case SpeculumControlOpCode::ViewportSet: {
        uint32_t contextId = 0;
        int32_t width = 0;
        int32_t height = 0;
        if (!reader.ReadUInt32(&contextId) || !reader.ReadInt32(&width) ||
            !reader.ReadInt32(&height)) {
          SendFault(correlationId, 0, "ViewportSet truncated");
          return;
        }
        HandleViewportSet(correlationId, contextId, width, height);
        return;
      }
      case SpeculumControlOpCode::HistoryGo: {
        uint32_t contextId = 0;
        int32_t delta = 0;
        if (!reader.ReadUInt32(&contextId) || !reader.ReadInt32(&delta)) {
          SendFault(correlationId, 0, "HistoryGo truncated");
          return;
        }
        HandleHistoryGo(correlationId, contextId, delta);
        return;
      }
      case SpeculumControlOpCode::Reload: {
        uint32_t contextId = 0;
        if (!reader.ReadUInt32(&contextId)) {
          SendFault(correlationId, 0, "Reload truncated");
          return;
        }
        HandleReload(correlationId, contextId);
        return;
      }
      case SpeculumControlOpCode::Stop: {
        uint32_t contextId = 0;
        if (!reader.ReadUInt32(&contextId)) {
          SendFault(correlationId, 0, "Stop truncated");
          return;
        }
        HandleStop(correlationId, contextId);
        return;
      }
      case SpeculumControlOpCode::DialogRespond: {
        uint32_t contextId = 0;
        uint32_t requestId = 0;
        nsCString answer;
        if (!reader.ReadUInt32(&contextId) || !reader.ReadUInt32(&requestId) ||
            !reader.ReadBytes(answer)) {
          SendFault(correlationId, 0, "DialogRespond truncated");
          return;
        }
        HandleDialogRespond(correlationId, contextId, requestId, answer);
        return;
      }
      case SpeculumControlOpCode::PermissionRespond: {
        uint32_t contextId = 0;
        uint32_t requestId = 0;
        uint8_t granted = 0;
        if (!reader.ReadUInt32(&contextId) || !reader.ReadUInt32(&requestId) ||
            !reader.ReadUInt8(&granted)) {
          SendFault(correlationId, 0, "PermissionRespond truncated");
          return;
        }
        nsAutoCString answer;
        answer.AssignASCII(granted ? "1" : "0");
        HandleDialogRespond(correlationId, contextId, requestId, answer);
        return;
      }
      case SpeculumControlOpCode::DownloadRespond: {
        uint32_t contextId = 0;
        uint32_t requestId = 0;
        uint8_t accepted = 0;
        if (!reader.ReadUInt32(&contextId) || !reader.ReadUInt32(&requestId) ||
            !reader.ReadUInt8(&accepted)) {
          SendFault(correlationId, 0, "DownloadRespond truncated");
          return;
        }
        nsAutoCString answer;
        answer.AssignASCII(accepted ? "1" : "0");
        HandleDialogRespond(correlationId, contextId, requestId, answer);
        return;
      }
      default:
        SPECULUM_LOG("[SPECULUM-CTRL-IGNORADO] opcode=0x%04x correlationId=%u",
                op, correlationId);
        return;
    }
  }

  void DispatchControlPayload(const uint8_t* aPayload, size_t aLength) {
    if (!aPayload || aLength < kSpeculumControlHeaderBytes) {
      return;
    }
    auto bytes = MakeUnique<uint8_t[]>(aLength);
    memcpy(bytes.get(), aPayload, aLength);
    NS_DispatchToMainThread(NS_NewRunnableFunction(
        "SpeculumHandleControl",
        [this, bytes = std::move(bytes), len = aLength]() mutable {
          HandleControlBinary(bytes.get(), len);
        }));
  }

  void ReadLoop() {
    while (!stopRead) {
      int localFd = -1;
      {
        mozilla::MutexAutoLock lock(sendMutex);
        localFd = fd;
      }
      if (localFd < 0) {
        usleep(100 * 1000);
        continue;
      }

      uint8_t header[9];
      if (!ReadExactly(localFd, header, sizeof(header))) {
        mozilla::MutexAutoLock lock(sendMutex);
        if (fd == localFd) {
          LogBridgeErr("socket read failed");
          CloseFdUnlocked();
        }
        continue;
      }

      const uint8_t kind = header[0];
      const uint32_t contextId = ReadU32LE(header + 1);
      const uint32_t payloadLen = ReadU32LE(header + 5);

      nsTArray<uint8_t> payload;
      if (payloadLen > 0) {
        if (!payload.SetLength(payloadLen, mozilla::fallible)) {
          mozilla::MutexAutoLock lock(sendMutex);
          if (fd == localFd) {
            LogBridgeErr("control payload alloc failed");
            CloseFdUnlocked();
          }
          continue;
        }
        if (!ReadExactly(localFd, payload.Elements(), payloadLen)) {
          mozilla::MutexAutoLock lock(sendMutex);
          if (fd == localFd) {
            LogBridgeErr("socket read failed");
            CloseFdUnlocked();
          }
          continue;
        }
      }

      if (kind == kKindCommand) {
        const size_t got = payload.Length();
        if (got < kSpeculumControlHeaderBytes) {
          SPECULUM_LOG(
                  "[SPECULUM-CTRL-ERR] comando curto ctx=%u declarado=%u lido=%zu",
                  contextId, payloadLen, got);
          continue;
        }
        DispatchControlPayload(payload.Elements(), got);
      } else if (kind == kKindAsset) {
        const uint32_t ctx = contextId;
        auto bytes = MakeUnique<uint8_t[]>(payload.Length());
        if (payload.Length() > 0) {
          memcpy(bytes.get(), payload.Elements(), payload.Length());
        }
        NS_DispatchToMainThread(NS_NewRunnableFunction(
            "SpeculumHandleAsset",
            [this, ctx, bytes = std::move(bytes), len = payload.Length()]() mutable {
              HandleAssetPayload(ctx, bytes.get(), len);
            }));
      }
    }
  }

  void DeliverFrame(uint32_t aContextId, uint32_t, base::ProcessId,
                    nsTArray<uint8_t>& aFrame) {
    const uint32_t len = static_cast<uint32_t>(aFrame.Length());
    if (!SendSync(kKindFrame, aContextId, aFrame.Elements(), len,
                  /*aControl=*/false)) {
      FailCataloguedImpl(aContextId, "bridge_down", "deliver",
                         "frame not delivered");
    }
  }

};

NS_IMPL_ISUPPORTS(SpeculumProjectionRuntime::Impl::ProgressSink,
                  nsIWebProgressListener, nsISupportsWeakReference)

NS_IMPL_ISUPPORTS(SpeculumProjectionRuntime::Impl::SoleChromeGuard,
                  nsIWindowMediatorListener)

NS_IMETHODIMP
SpeculumProjectionRuntime::Impl::ProgressSink::OnStateChange(
    nsIWebProgress* aWebProgress, nsIRequest*, uint32_t aStateFlags,
    nsresult aStatus) {
  if (!mImpl || !aWebProgress) {
    return NS_OK;
  }
  bool isTop = false;
  if (NS_FAILED(aWebProgress->GetIsTopLevel(&isTop)) || !isTop) {
    return NS_OK;
  }
  const bool isWindow = aStateFlags & nsIWebProgressListener::STATE_IS_WINDOW;
  const bool isDocument =
      aStateFlags & nsIWebProgressListener::STATE_IS_DOCUMENT;
  const bool isNetwork = aStateFlags & nsIWebProgressListener::STATE_IS_NETWORK;
  // Antes exigia WINDOW∧NETWORK — em process-switch / HTTPS o STOP às vezes
  // chega só como WINDOW|DOCUMENT e o Navigated nunca fechava (Beleza cold).
  if (!(isWindow || isDocument)) {
    return NS_OK;
  }
  if (!isWindow && !isNetwork) {
    // DOCUMENT-only sem rede: ruído de subrecursos.
    return NS_OK;
  }

  if (aStateFlags & nsIWebProgressListener::STATE_START) {
    if (isWindow || isNetwork) {
      mSawLoadStart = true;
      mImpl->SendLoadState(mContextId, kLoadStateStart);
    }
    return NS_OK;
  }
  if (!(aStateFlags & nsIWebProgressListener::STATE_STOP)) {
    return NS_OK;
  }
  if (!isWindow) {
    return NS_OK;
  }

  mImpl->SendLoadState(mContextId, kLoadStateStop);

  // Carga substituída — o STOP abortado não é o commit. Espera o próximo.
  // Se a URI ainda é blank, o LoadURI pedido pode ter morrido com o abort
  // (medido em Beleza cold): retenta uma vez.
  if (aStatus == NS_BINDING_ABORTED) {
    SPECULUM_LOG("[SPECULUM-CTRL] STOP aborted ctx=%u waitingNav=%d",
                 mContextId, int(mWaitingNavigated));
    if (mWaitingNavigated &&
        (mLastLocation.IsEmpty() ||
         mLastLocation.EqualsLiteral("about:blank"))) {
      mImpl->RetryLoadURIAfterAbort(mContextId);
    }
    return NS_OK;
  }

  if (mWaitingCreated) {
    mWaitingCreated = false;
    mImpl->SendContextCreated(mCreatedCorrelation, mContextId, mBcId);
    return NS_OK;
  }

  if (!mWaitingNavigated) {
    return NS_OK;
  }

  nsCOMPtr<mozIDOMWindowProxy> win;
  if (NS_SUCCEEDED(aWebProgress->GetDOMWindow(getter_AddRefs(win))) && win) {
    if (nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(win)) {
      if (mozilla::dom::BrowsingContext* docBc = outer->GetBrowsingContext()) {
        mImpl->AdoptLiveRootBc(mContextId, docBc->Top());
        if (CanonicalBrowsingContext* canonical = docBc->Canonical()) {
          if (nsCOMPtr<nsIURI> uri = canonical->GetCurrentURI()) {
            nsAutoCString live;
            if (NS_SUCCEEDED(uri->GetSpec(live)) && !live.IsEmpty()) {
              mLastLocation = live;
            }
          }
        }
      }
    }
  }

  nsAutoCString spec(mLastLocation);
  if (spec.IsEmpty()) {
    spec.AssignLiteral("about:blank");
  }
  if (!spec.EqualsLiteral("about:blank")) {
    mSawExpectedLocation = true;
  }
  FinishNavigatedIfReady(spec, aStatus);

  // Document replace depois do Navigated pedido (challenge → página final).
  if (!mWaitingNavigated && !mWaitingCreated &&
      !spec.EqualsLiteral("about:blank") &&
      !mLastCommittedSpec.IsEmpty() && !spec.Equals(mLastCommittedSpec)) {
    SPECULUM_LOG("[SPECULUM-CTRL] follow-on Navigated ctx=%u url=%s",
                 mContextId, spec.get());
    mLastCommittedSpec = spec;
    mImpl->SendNavigated(/*correlation*/ 0, mContextId, spec);
  }
  return NS_OK;
}

void SpeculumProjectionRuntime::Impl::ProgressSink::FinishNavigatedIfReady(
    const nsACString& aSpec, nsresult aStatus) {
  if (!mImpl || !mWaitingNavigated) {
    return;
  }
  // URL já é a pedida (ou qualquer não-blank depois do LoadURI): o START
  // pode ter caído no listener antigo no rebind. Location é o commit.
  // STOP leftover de about:blank não passa daqui — mSawExpectedLocation
  // fica falso até OnLocationChange ver um spec real.
  if (!mSawExpectedLocation) {
    if (!mSawLoadStart) {
      return;
    }
    if (!mExpectedSpec.IsEmpty() &&
        !mExpectedSpec.EqualsLiteral("about:blank")) {
      return;
    }
  }

  mWaitingNavigated = false;
  mSawLoadStart = false;
  mSawExpectedLocation = false;
  mExpectedSpec.Truncate();

  if (NS_FAILED(aStatus)) {
    mImpl->SendFault(mNavigatedCorrelation, mContextId, "load failed");
    return;
  }

  nsCString spec(aSpec);
  if (spec.IsEmpty()) {
    spec.AssignLiteral("about:blank");
  }
  mImpl->SendNavigated(mNavigatedCorrelation, mContextId, spec);
  mLastCommittedSpec = spec;
}

NS_IMETHODIMP
SpeculumProjectionRuntime::Impl::ProgressSink::OnProgressChange(
    nsIWebProgress*, nsIRequest*, int32_t, int32_t, int32_t, int32_t) {
  return NS_OK;
}

NS_IMETHODIMP
SpeculumProjectionRuntime::Impl::ProgressSink::OnLocationChange(
    nsIWebProgress* aWebProgress, nsIRequest*, nsIURI* aLocation,
    uint32_t aFlags) {
  if (!aWebProgress || !aLocation) {
    return NS_OK;
  }
  bool isTop = false;
  if (NS_FAILED(aWebProgress->GetIsTopLevel(&isTop)) || !isTop) {
    return NS_OK;
  }
  if (aFlags & nsIWebProgressListener::LOCATION_CHANGE_ERROR_PAGE) {
    return NS_OK;
  }
  (void)aLocation->GetSpec(mLastLocation);
  if (!mExpectedSpec.IsEmpty() &&
      !mExpectedSpec.EqualsLiteral("about:blank") &&
      !mLastLocation.IsEmpty() &&
      !mLastLocation.EqualsLiteral("about:blank")) {
    mSawExpectedLocation = true;
  }
  nsCOMPtr<mozIDOMWindowProxy> win;
  if (NS_SUCCEEDED(aWebProgress->GetDOMWindow(getter_AddRefs(win))) && win) {
    if (nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(win)) {
      if (mozilla::dom::BrowsingContext* docBc = outer->GetBrowsingContext()) {
        mImpl->AdoptLiveRootBc(mContextId, docBc->Top());
      }
    }
  }
  if (mWaitingNavigated) {
    SPECULUM_LOG("[SPECULUM-CTRL] OnLocationChange ctx=%u url=%s sawExpected=%d",
                 mContextId, mLastLocation.get(), int(mSawExpectedLocation));
  }
  // Navigated do pedido fecha no STOP. Aqui só atualiza location.
  return NS_OK;
}

NS_IMETHODIMP
SpeculumProjectionRuntime::Impl::ProgressSink::OnStatusChange(
    nsIWebProgress*, nsIRequest*, nsresult, const char16_t*) {
  return NS_OK;
}

NS_IMETHODIMP
SpeculumProjectionRuntime::Impl::ProgressSink::OnSecurityChange(
    nsIWebProgress*, nsIRequest*, uint32_t) {
  return NS_OK;
}

NS_IMETHODIMP
SpeculumProjectionRuntime::Impl::ProgressSink::OnContentBlockingEvent(
    nsIWebProgress*, nsIRequest*, uint32_t) {
  return NS_OK;
}

SpeculumProjectionRuntime* sRuntime = nullptr;

SpeculumProjectionRuntime::SpeculumProjectionRuntime() {
  const char* sockEnv = getenv("SPECULUM_BROWSER_SOCKET");
  if (!sockEnv || !sockEnv[0]) {
    FatalRuntime("SPECULUM_BROWSER_SOCKET ausente");
  }
  mImpl = MakeUnique<Impl>(std::string(sockEnv));
}

SpeculumProjectionRuntime::~SpeculumProjectionRuntime() = default;

void SpeculumProjectionRuntime::Startup() {
  if (!XRE_IsParentProcess()) {
    return;
  }
  if (sRuntime) {
    return;
  }
  // Singleton de vida do processo — não destruído no shutdown do browser.
  sRuntime = new SpeculumProjectionRuntime();
}

SpeculumProjectionRuntime& SpeculumProjectionRuntime::Get() {
  MOZ_RELEASE_ASSERT(sRuntime);
  return *sRuntime;
}

void SpeculumProjectionRuntime::DeliverFrame(
    uint32_t aContextId, uint32_t aSequence, base::ProcessId aChildPid,
    nsTArray<uint8_t>& aFrame) {
  mImpl->DeliverFrame(aContextId, aSequence, aChildPid, aFrame);
}

void SpeculumProjectionRuntime::NotePublishedNested(
    const nsTArray<uint32_t>& aChildContextIds) {
  mImpl->NotePublishedNested(aChildContextIds);
}

void SpeculumProjectionRuntime::NoteNestedStandby(uint32_t aContextId) {
  mImpl->NoteNestedStandby(aContextId);
}

uint32_t SpeculumProjectionRuntime::ClaimGeneration(uint32_t aContextId) {
  return mImpl->ClaimGeneration(aContextId);
}

[[noreturn]] void SpeculumProjectionRuntime::FailCatalogued(
    uint32_t aContextId, const char* aCode, const char* aPhase,
    const char* aMsg) {
  if (sRuntime && sRuntime->mImpl) {
    sRuntime->mImpl->FailCataloguedImpl(aContextId, aCode, aPhase, aMsg);
  }
  SpeculumEmitProducerFault(aContextId, aCode, aPhase);
  FatalRuntime(aMsg);
}

void SpeculumProjectionRuntime::DeliverSnapshot(
    uint32_t aContextId, uint32_t aCorrelationId, uint32_t aSequence,
    uint32_t aGeneration, uint64_t aTableHash, nsTArray<uint8_t>& aDump) {
  mImpl->DeliverSnapshot(aContextId, aCorrelationId, aSequence, aGeneration,
                         aTableHash, aDump);
}

void SpeculumProjectionRuntime::DeliverDialogRequested(
    uint32_t aContextId, uint32_t aRequestId, const nsACString& aDescription) {
  mImpl->SendRequested(SpeculumControlOpCode::DialogRequested, aContextId,
                       aRequestId, aDescription);
}

void SpeculumProjectionRuntime::DeliverPermissionRequested(
    uint32_t aContextId, uint32_t aRequestId, const nsACString& aDescription) {
  mImpl->SendRequested(SpeculumControlOpCode::PermissionRequested, aContextId,
                       aRequestId, aDescription);
}

void SpeculumProjectionRuntime::DeliverDownloadRequested(
    uint32_t aContextId, uint32_t aRequestId, const nsACString& aDescription) {
  mImpl->SendRequested(SpeculumControlOpCode::DownloadRequested, aContextId,
                       aRequestId, aDescription);
}

void SpeculumProjectionRuntime::DeliverTelemetry(uint32_t aContextId,
                                                 nsTArray<uint8_t>& aPayload) {
  mImpl->SendTelemetryEnvelope(aContextId, aPayload.Elements(),
                               aPayload.Length());
}

uint32_t SpeculumProjectionRuntime::MintNestedContextId() {
  if (!sRuntime) {
    return 0;
  }
  return sRuntime->mImpl->MintNestedContextId();
}

already_AddRefed<nsIPrincipal> SpeculumProjectionRuntime::DocumentPrincipalOf(
    uint32_t aContextId) {
  return mImpl->DocumentPrincipalOf(aContextId);
}
