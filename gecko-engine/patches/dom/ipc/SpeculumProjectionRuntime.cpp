/* Speculum — runtime de projeção no processo base (doc 17). */
#include "SpeculumProjectionRuntime.h"

#include "SpeculumControlAbi.h"
#include "mozilla/SystemPrincipal.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/ContentParent.h"
#include "mozilla/ErrorResult.h"
#include "mozilla/Mutex.h"
#include "mozilla/NullPrincipal.h"
#include "mozilla/StaticMutex.h"
#include "mozilla/UniquePtr.h"
#include "nsAppRunner.h"
#include "nsComponentManagerUtils.h"
#include "nsGlobalWindowOuter.h"
#include "nsIMutableArray.h"
#include "nsIURI.h"
#include "nsIWindowWatcher.h"
#include "nsNetUtil.h"
#include "nsPIDOMWindow.h"
#include "nsPIDOMWindowInlines.h"
#include "nsSupportsPrimitives.h"
#include "nsThreadUtils.h"

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
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
using mozilla::dom::ContentParent;
using mozilla::NullPrincipal;

namespace {

constexpr uint8_t kKindFrame = 0x01;
constexpr uint8_t kKindEvent = 0x02;
constexpr uint8_t kKindHello = 0x03;
constexpr uint8_t kKindCommand = 0x04;

void LogBridgeErr(const char* aMsg) {
  fprintf(stderr, "[SPECULUM-RUNTIME-ERR] %s\n", aMsg);
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

bool ReadAll(int aFd, void* aData, size_t aLen) {
  uint8_t* p = static_cast<uint8_t*>(aData);
  size_t left = aLen;
  while (left > 0) {
    const ssize_t n = recv(aFd, p, left, 0);
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

}  // namespace

struct SpeculumProjectionRuntime::Impl {
  StaticMutex projectedMutex;
  std::map<uint32_t, RefPtr<BrowsingContext>> contextToRootBc;
  std::map<uint64_t, uint32_t> bcIdToContextId;
  std::map<uint32_t, nsCOMPtr<mozIDOMWindowProxy>> contextToWindow;

  std::string socketPath;
  int fd = -1;
  mozilla::Mutex sendMutex{"SpeculumProjectionRuntime"};
  std::atomic<bool> stopRead{false};
  std::thread readThread;

  explicit Impl(std::string aPath) : socketPath(std::move(aPath)) {
    ConnectOrDie();
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
    fprintf(stderr, "[SPECULUM-RUNTIME] ponte conectada em %s\n",
            socketPath.c_str());
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

  void BroadcastProjectContext(uint64_t aBrowsingContextId, uint32_t aContextId) {
    for (auto* cp : ContentParent::AllProcesses(ContentParent::eLive)) {
      (void)cp->SendSpeculumProjectContext(aBrowsingContextId, aContextId);
    }
  }

  void BroadcastUnprojectContext(uint64_t aBrowsingContextId) {
    for (auto* cp : ContentParent::AllProcesses(ContentParent::eLive)) {
      (void)cp->SendSpeculumUnprojectContext(aBrowsingContextId);
    }
  }

  void HandleContextCreate(uint32_t aCorrelationId, uint32_t aContextId,
                           int32_t aWidth, int32_t aHeight) {
    StaticMutexAutoLock lock(projectedMutex);
    if (contextToRootBc.find(aContextId) != contextToRootBc.end()) {
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
    if (bcIdToContextId.find(bcId) != bcIdToContextId.end()) {
      SendFault(aCorrelationId, aContextId, "browsing context already registered");
      return;
    }

    contextToRootBc.emplace(aContextId, bc);
    bcIdToContextId.emplace(bcId, aContextId);
    contextToWindow.emplace(aContextId, window);

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
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
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
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
  }

  void HandleNavigate(uint32_t aCorrelationId, uint32_t aContextId,
                      const nsACString& aUrl) {
    RefPtr<BrowsingContext> bc;
    {
      StaticMutexAutoLock lock(projectedMutex);
      const auto found = contextToRootBc.find(aContextId);
      if (found == contextToRootBc.end()) {
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
    SendEvent(buffer, static_cast<uint32_t>(writer.Length()));
  }

  void HandleControlBinary(const uint8_t* aData, size_t aLength) {
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
                "[SPECULUM-CTRL-IGNORADO] opcode=0x%04x correlationId=%u\n",
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
      if (!ReadAll(localFd, header, sizeof(header))) {
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
        if (!ReadAll(localFd, payload.Elements(), payloadLen)) {
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
          fprintf(stderr,
                  "[SPECULUM-CTRL-ERR] comando curto ctx=%u declarado=%u "
                  "lido=%zu\n",
                  contextId, payloadLen, got);
          continue;
        }
        DispatchControlPayload(payload.Elements(), got);
      }
    }
  }

  void DeliverFrame(uint32_t aContextId, uint64_t, uint32_t, base::ProcessId,
                    nsTArray<uint8_t>& aFrame) {
    mozilla::MutexAutoLock lock(sendMutex);
    if (fd < 0) {
      return;
    }
    const uint32_t len = static_cast<uint32_t>(aFrame.Length());
    if (!SendEnvelope(fd, kKindFrame, aContextId, aFrame.Elements(), len)) {
      LogBridgeErr("frame send failed");
      CloseFdUnlocked();
    }
  }

  void ReplayProjectedContexts(ContentParent* aChild) {
    if (!aChild) {
      return;
    }
    StaticMutexAutoLock lock(projectedMutex);
    for (const auto& entry : contextToRootBc) {
      if (RefPtr<BrowsingContext> bc = entry.second) {
        (void)aChild->SendSpeculumProjectContext(bc->Id(), entry.first);
      }
    }
  }
};

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

void SpeculumProjectionRuntime::ReplayProjectedContexts(
    ContentParent* aChild) {
  mImpl->ReplayProjectedContexts(aChild);
}
