/* Speculum — runtime de projeção no processo base (doc 17). */
#include "SpeculumProjectionRuntime.h"

#include "SpeculumAssetRegistry.h"
#include "SpeculumControlAbi.h"
#include "SpeculumLog.h"
#include "SpeculumMarionette.h"
#include "mozilla/SystemPrincipal.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/CanonicalBrowsingContext.h"
#include "mozilla/dom/ContentParent.h"
#include "mozilla/dom/WindowGlobalParent.h"
#include "mozilla/ErrorResult.h"
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
#include "nsNetUtil.h"
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
#include <map>
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

nsresult OpenSpeculumBrowserWindow(int32_t aWidth, int32_t aHeight,
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

}  // namespace

struct SpeculumProjectionRuntime::Impl {
  // Um documento de topo, uma geração. Guardado por contexto e protegido pelo
  // sendMutex, que é o lock do caminho do frame.
  struct Epoch {
    uint64_t docToken;
    uint32_t generation;
  };

  mozilla::Mutex mintMutex{"SpeculumMint"};
  uint32_t nextNestedContextId = 2;

  uint32_t MintNestedContextId() {
    mozilla::MutexAutoLock lock(mintMutex);
    if (nextNestedContextId < 2) {
      nextNestedContextId = 2;
    }
    return nextNestedContextId++;
  }

  StaticMutex projectedMutex;
  std::map<uint32_t, RefPtr<BrowsingContext>> contextToRootBc;
  std::map<uint64_t, uint32_t> bcIdToContextId;
  std::map<uint32_t, nsCOMPtr<mozIDOMWindowProxy>> contextToWindow;
  std::map<uint32_t, Epoch> epochs;

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
    void WaitForNavigated(uint32_t aCorrelationId) {
      mNavigatedCorrelation = aCorrelationId;
      mWaitingNavigated = true;
      mSawLoadStart = false;
    }
    void CancelWaitForNavigated() {
      mWaitingNavigated = false;
      mSawLoadStart = false;
    }
    void SetProgress(nsIWebProgress* aProgress) { mProgress = aProgress; }
    void DetachFromProgress() {
      if (mProgress) {
        (void)mProgress->RemoveProgressListener(this);
        mProgress = nullptr;
      }
      mWaitingCreated = false;
      mWaitingNavigated = false;
    }

   private:
    ~ProgressSink() { DetachFromProgress(); }

    Impl* mImpl;
    const uint32_t mContextId;
    const uint64_t mBcId;
    bool mWaitingCreated = false;
    bool mWaitingNavigated = false;
    bool mSawLoadStart = false;
    uint32_t mCreatedCorrelation = 0;
    uint32_t mNavigatedCorrelation = 0;
    nsCOMPtr<nsIWebProgress> mProgress;
    nsCString mLastLocation;
  };

  std::map<uint32_t, RefPtr<ProgressSink>> progressSinks;

  std::string socketPath;
  int fd = -1;
  mozilla::Mutex sendMutex{"SpeculumProjectionRuntime"};
  std::atomic<bool> stopRead{false};
  std::thread readThread;

  explicit Impl(std::string aPath) : socketPath(std::move(aPath)) {
    ConnectOrDie();
    SpeculumAssetRegistry::Get();
    readThread = std::thread([this]() { ReadLoop(); });
  }

  ~Impl() {
    stopRead = true;
    {
      mozilla::MutexAutoLock lock(sendMutex);
      if (fd >= 0) {
        shutdown(fd, SHUT_RDWR);
      }
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
    uint8_t readyPayload[kSpeculumControlHeaderBytes];
    SpeculumControlWriter readyWriter(
        readyPayload, sizeof(readyPayload), SpeculumControlOpCode::Ready, 0);
    if (!readyWriter.Ok()) {
      close(sock);
      FatalRuntime("ready encode failed");
    }
    if (!SendEnvelope(sock, kKindEvent, 0, readyPayload,
                      static_cast<uint32_t>(readyWriter.Length()))) {
      close(sock);
      FatalRuntime("ready send failed");
    }
    fd = sock;
    SPECULUM_LOG("[SPECULUM-RUNTIME] ponte conectada em %s", socketPath.c_str());
  }

  bool SendEvent(const uint8_t* aPayload, uint32_t aLength) {
    mozilla::MutexAutoLock lock(sendMutex);
    if (fd < 0) {
      return false;
    }
    if (!SendEnvelope(fd, kKindEvent, 0, aPayload, aLength)) {
      LogBridgeErr("event send failed");
      CloseFdUnlocked();
      return false;
    }
    return true;
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

  // A aba troca de BrowsingContext (bfcache, remoteness, COOP). O campo
  // SpeculumContextId vai no ReplacedBy; o ponteiro que o runtime guarda
  // precisa acompanhar, senão o Navigate seguinte fala com a aba velha.
  void AdoptLiveRootBc(uint32_t aContextId, BrowsingContext* aLive) {
    if (!aLive) {
      return;
    }
    StaticMutexAutoLock lock(projectedMutex);
    const auto found = contextToRootBc.find(aContextId);
    if (found == contextToRootBc.end() || found->second == aLive) {
      return;
    }
    const uint64_t oldId = found->second->Id();
    const uint64_t newId = aLive->Id();
    found->second = aLive;
    bcIdToContextId.erase(oldId);
    bcIdToContextId[newId] = aContextId;
    SPECULUM_LOG("[SPECULUM-BC] remap ctx=%u oldBc=%llu newBc=%llu",
            aContextId, static_cast<unsigned long long>(oldId),
            static_cast<unsigned long long>(newId));
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
    RefPtr<BrowsingContext> live = PrimaryContentTop(window);
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

    // Abrir a janela e esperar a content BC ficam FORA do lock: a espera roda o
    // event loop, e segurar o StaticMutex durante isso poderia travar contra
    // qualquer outro caminho que o pegue no main thread.
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

    // A janela aberta é o CHROME (browser.xhtml). O documento projetado vive na
    // BrowsingContext de CONTEÚDO da aba — e é a top BC do conteúdo que o produtor
    // usa como chave (SpeculumAttachMutationObserverToDocument). Registrar a BC do
    // chrome nunca casa com a do conteúdo: por isso nenhum frame subia.
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

    // A aba de conteúdo não existe no instante em que OpenWindow retorna; ela
    // aparece um tique depois. Espera a primary content BC surgir, com teto.
    RefPtr<BrowsingContext> contentBc;
    const mozilla::TimeStamp deadline =
        mozilla::TimeStamp::Now() + mozilla::TimeDuration::FromSeconds(10);
    (void)mozilla::SpinEventLoopUntil(
        "SpeculumWaitContentBrowsingContext"_ns, [&]() -> bool {
          treeOwner->GetPrimaryContentBrowsingContext(getter_AddRefs(contentBc));
          return contentBc || mozilla::TimeStamp::Now() >= deadline;
        });

    SPECULUM_LOG("[SPECULUM-CTX] ctx=%u chromeBc=%llu contentBc=%llu",
            aContextId,
            static_cast<unsigned long long>(chromeBc ? chromeBc->Id() : 0),
            static_cast<unsigned long long>(contentBc ? contentBc->Id() : 0));

    if (!contentBc) {
      SendFault(aCorrelationId, aContextId, "no primary content browsing context");
      return;
    }

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

    const auto foundSink = progressSinks.find(aContextId);
    if (foundSink == progressSinks.end()) {
      SendFault(aCorrelationId, aContextId, "no progress listener");
      return;
    }
    // Armar ANTES do Navigate: o START pode chegar síncrono. Sem isto o STOP
    // da carga anterior (about:blank, página velha) vira Navigated falso.
    foundSink->second->WaitForNavigated(aCorrelationId);

    RefPtr<nsIPrincipal> systemPrincipal = SystemPrincipal::Get();
    ErrorResult error;
    bc->Navigate(uri, /* aSourceDocument */ nullptr, *systemPrincipal, error);
    if (error.Failed()) {
      foundSink->second->CancelWaitForNavigated();
      SendFault(aCorrelationId, aContextId, "navigate failed");
      return;
    }
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

  void HandleHistoryGo(uint32_t aCorrelationId, uint32_t aContextId,
                       int32_t aDelta) {
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
    mozilla::dom::Optional<int32_t> epoch;
    const int32_t steps = aDelta < 0 ? -aDelta : aDelta;
    for (int32_t i = 0; i < steps; ++i) {
      if (aDelta < 0) {
        canonical->GoBack(epoch, false, true);
      } else {
        canonical->GoForward(epoch, false, true);
      }
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
    nsDependentCString desc(aDescription);
    if (!writer.WriteUInt32(aContextId) || !writer.WriteUInt32(aRequestId) ||
        !writer.WriteBytes(desc) || !writer.Ok()) {
      return;
    }
    SendEvent(buffer.get(), static_cast<uint32_t>(writer.Length()));
  }

  bool SendAssetEnvelope(uint32_t aContextId, const uint8_t* aPayload,
                         uint32_t aLength) {
    mozilla::MutexAutoLock lock(sendMutex);
    if (fd < 0) {
      return false;
    }
    if (!SendEnvelope(fd, kKindAsset, aContextId, aPayload, aLength)) {
      LogBridgeErr("asset send failed");
      CloseFdUnlocked();
      return false;
    }
    return true;
  }

  bool SendTelemetryEnvelope(uint32_t aContextId, const uint8_t* aPayload,
                             uint32_t aLength) {
    mozilla::MutexAutoLock lock(sendMutex);
    if (fd < 0) {
      return false;
    }
    if (!SendEnvelope(fd, kKindTelemetry, aContextId, aPayload, aLength)) {
      LogBridgeErr("telemetry send failed");
      CloseFdUnlocked();
      return false;
    }
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

  // Época por contextId: cada Document daquele C é uma geração. O processo de
  // conteúdo nasce com o documento e não sabe quantos vieram antes; quem vê
  // todos os frames do contexto é o runtime. Iframe e aba têm relógios
  // independentes. Sem isto, a página nova chega como continuação da anterior.
  void StampGenerationLocked(uint32_t aContextId, uint64_t aDocToken,
                             nsTArray<uint8_t>& aFrame) {
    constexpr size_t kGenerationOffset = 8;
    if (aFrame.Length() < kGenerationOffset + sizeof(uint32_t)) {
      return;
    }

    auto found = epochs.find(aContextId);
    if (found == epochs.end()) {
      found = epochs.emplace(aContextId, Epoch{aDocToken, 1}).first;
    } else if (found->second.docToken != aDocToken) {
      found->second.docToken = aDocToken;
      found->second.generation++;
    }

    const uint32_t generation = found->second.generation;
    uint8_t* p = aFrame.Elements() + kGenerationOffset;
    p[0] = static_cast<uint8_t>(generation & 0xffu);
    p[1] = static_cast<uint8_t>((generation >> 8) & 0xffu);
    p[2] = static_cast<uint8_t>((generation >> 16) & 0xffu);
    p[3] = static_cast<uint8_t>((generation >> 24) & 0xffu);
  }

  void DeliverFrame(uint32_t aContextId, uint64_t aDocToken, uint32_t,
                    base::ProcessId, nsTArray<uint8_t>& aFrame) {
    mozilla::MutexAutoLock lock(sendMutex);
    StampGenerationLocked(aContextId, aDocToken, aFrame);
    if (fd < 0) {
      return;
    }
    const uint32_t len = static_cast<uint32_t>(aFrame.Length());
    if (!SendEnvelope(fd, kKindFrame, aContextId, aFrame.Elements(), len)) {
      LogBridgeErr("frame send failed");
      CloseFdUnlocked();
    }
  }

};

NS_IMPL_ISUPPORTS(SpeculumProjectionRuntime::Impl::ProgressSink,
                  nsIWebProgressListener, nsISupportsWeakReference)

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
  const bool isNetwork = aStateFlags & nsIWebProgressListener::STATE_IS_NETWORK;
  if (!isWindow || !isNetwork) {
    return NS_OK;
  }

  if (aStateFlags & nsIWebProgressListener::STATE_START) {
    mSawLoadStart = true;
    mImpl->SendLoadState(mContextId, kLoadStateStart);
    return NS_OK;
  }
  if (!(aStateFlags & nsIWebProgressListener::STATE_STOP)) {
    return NS_OK;
  }

  mImpl->SendLoadState(mContextId, kLoadStateStop);

  // Carga substituída — o STOP abortado não é o commit. Espera o próximo.
  if (aStatus == NS_BINDING_ABORTED) {
    return NS_OK;
  }

  if (mWaitingCreated) {
    mWaitingCreated = false;
    mImpl->SendContextCreated(mCreatedCorrelation, mContextId, mBcId);
    return NS_OK;
  }

  if (!mWaitingNavigated || !mSawLoadStart) {
    return NS_OK;
  }
  mWaitingNavigated = false;
  mSawLoadStart = false;

  if (NS_FAILED(aStatus)) {
    mImpl->SendFault(mNavigatedCorrelation, mContextId, "load failed");
    return NS_OK;
  }

  nsCOMPtr<mozIDOMWindowProxy> win;
  if (NS_SUCCEEDED(aWebProgress->GetDOMWindow(getter_AddRefs(win))) && win) {
    if (nsCOMPtr<nsPIDOMWindowOuter> outer = nsPIDOMWindowOuter::From(win)) {
      if (mozilla::dom::BrowsingContext* docBc = outer->GetBrowsingContext()) {
        mImpl->AdoptLiveRootBc(mContextId, docBc->Top());
      }
    }
  }

  nsAutoCString spec(mLastLocation);
  if (spec.IsEmpty()) {
    RefPtr<BrowsingContext> bc;
    {
      StaticMutexAutoLock lock(mImpl->projectedMutex);
      const auto found = mImpl->contextToRootBc.find(mContextId);
      if (found != mImpl->contextToRootBc.end()) {
        bc = found->second;
      }
    }
    if (bc && !bc->IsDiscarded()) {
      if (CanonicalBrowsingContext* canonical = bc->Canonical()) {
        if (nsCOMPtr<nsIURI> uri = canonical->GetCurrentURI()) {
          (void)uri->GetSpec(spec);
        }
      }
    }
  }
  if (spec.IsEmpty()) {
    spec.AssignLiteral("about:blank");
  }
  mImpl->SendNavigated(mNavigatedCorrelation, mContextId, spec);
  return NS_OK;
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
    uint32_t aContextId, uint64_t aDocToken, uint32_t aSequence,
    base::ProcessId aChildPid, nsTArray<uint8_t>& aFrame) {
  mImpl->DeliverFrame(aContextId, aDocToken, aSequence, aChildPid, aFrame);
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
