/* Speculum — ponte de controle com o supervisor (doc 12); frames trafegam aqui. */
#include "SpeculumSupervisorLink.h"
#include "SpeculumControlHandler.h"

#include "mozilla/Mutex.h"
#include "mozilla/UniquePtr.h"
#include "nsAppRunner.h"

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/socket.h>
#include <sys/un.h>
#include <thread>
#include <unistd.h>

namespace {

constexpr uint8_t kKindFrame = 0x01;
constexpr uint8_t kKindBrowserEvent = 0x02;
constexpr uint8_t kKindHello = 0x03;
constexpr uint8_t kKindControl = 0x04;

constexpr char kReadyBrowserEvent[] = R"({"type":"Ready","id":0})";

void LogLinkErr(const char* aMsg) {
  fprintf(stderr, "[SPECULUM-LINK-ERR] %s\n", aMsg);
}

[[noreturn]] void FatalSupervisorLink(const char* aMsg) {
  fprintf(stderr, "[SPECULUM-LINK-FATAL] %s\n", aMsg);
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

class NullLink final : public SpeculumSupervisorLink {
 public:
  void DeliverFrame(uint32_t, uint64_t, uint32_t, base::ProcessId,
                    nsTArray<uint8_t>&) override {}
};

class SocketLink final : public SpeculumSupervisorLink {
 public:
  explicit SocketLink(std::string aPath) : mPath(std::move(aPath)), mFd(-1) {
    ConnectOrDie();
    mReadThread = std::thread([this]() { ReadLoop(); });
  }

  ~SocketLink() override {
    mStopRead = true;
    {
      mozilla::MutexAutoLock lock(mMutex);
      if (mFd >= 0) {
        shutdown(mFd, SHUT_RDWR);
      }
    }
    if (mReadThread.joinable()) {
      mReadThread.join();
    }
    mozilla::MutexAutoLock lock(mMutex);
    if (mFd >= 0) {
      close(mFd);
      mFd = -1;
    }
  }

  void DeliverFrame(uint32_t aContextId, uint64_t, uint32_t, base::ProcessId,
                    nsTArray<uint8_t>& aFrame) override {
    mozilla::MutexAutoLock lock(mMutex);
    if (mFd < 0) {
      return;
    }
    const uint32_t len = static_cast<uint32_t>(aFrame.Length());
    if (!SendEnvelope(mFd, kKindFrame, aContextId, aFrame.Elements(), len)) {
      LogLinkErr("frame send failed");
      CloseFdUnlocked();
    }
  }

  void SendBrowserEvent(uint32_t aContextId, const char* aJsonUtf8,
                        uint32_t aJsonLength) override {
    if (!aJsonUtf8 || aJsonLength == 0) {
      return;
    }
    mozilla::MutexAutoLock lock(mMutex);
    if (mFd < 0) {
      return;
    }
    if (!SendEnvelope(mFd, kKindBrowserEvent, aContextId, aJsonUtf8,
                      aJsonLength)) {
      LogLinkErr("browser event send failed");
      CloseFdUnlocked();
    }
  }

 private:
  void CloseFdUnlocked() {
    if (mFd >= 0) {
      close(mFd);
      mFd = -1;
    }
  }

  void ConnectOrDie() {
    const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
      FatalSupervisorLink("socket create failed");
    }
    sockaddr_un addr {};
    if (mPath.size() >= sizeof(addr.sun_path)) {
      close(fd);
      FatalSupervisorLink("socket path too long");
    }
    addr.sun_family = AF_UNIX;
    memcpy(addr.sun_path, mPath.c_str(), mPath.size() + 1);
    if (connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
      close(fd);
      FatalSupervisorLink("socket connect failed");
    }
    if (!SendEnvelope(fd, kKindHello, 0, nullptr, 0)) {
      close(fd);
      FatalSupervisorLink("hello send failed");
    }
    if (!SendEnvelope(fd, kKindBrowserEvent, 0, kReadyBrowserEvent,
                      static_cast<uint32_t>(sizeof(kReadyBrowserEvent) - 1))) {
      close(fd);
      FatalSupervisorLink("ready send failed");
    }
    mFd = fd;
    fprintf(stderr, "[SPECULUM-LINK] conectado em %s\n", mPath.c_str());
  }

  void HandleControlPayload(const uint8_t* aPayload, uint32_t aLength) {
    if (!aPayload || aLength == 0) {
      return;
    }
    fprintf(stderr, "[SPECULUM-CTRL] %.*s\n", static_cast<int>(aLength),
            reinterpret_cast<const char*>(aPayload));
    SpeculumDispatchControlPayload(reinterpret_cast<const char*>(aPayload),
                                   aLength);
  }

  void ReadLoop() {
    while (!mStopRead) {
      int fd = -1;
      {
        mozilla::MutexAutoLock lock(mMutex);
        fd = mFd;
      }
      if (fd < 0) {
        usleep(100 * 1000);
        continue;
      }

      uint8_t header[9];
      if (!ReadAll(fd, header, sizeof(header))) {
        mozilla::MutexAutoLock lock(mMutex);
        if (mFd == fd) {
          LogLinkErr("socket read failed");
          CloseFdUnlocked();
        }
        continue;
      }

      const uint8_t kind = header[0];
      const uint32_t contextId = ReadU32LE(header + 1);
      const uint32_t length = ReadU32LE(header + 5);
      (void)contextId;

      nsTArray<uint8_t> payload;
      if (length > 0) {
        if (!payload.SetLength(length, mozilla::fallible)) {
          mozilla::MutexAutoLock lock(mMutex);
          if (mFd == fd) {
            LogLinkErr("control payload alloc failed");
            CloseFdUnlocked();
          }
          continue;
        }
        if (!ReadAll(fd, payload.Elements(), length)) {
          mozilla::MutexAutoLock lock(mMutex);
          if (mFd == fd) {
            LogLinkErr("socket read failed");
            CloseFdUnlocked();
          }
          continue;
        }
      }

      if (kind == kKindControl) {
        HandleControlPayload(payload.Elements(), length);
      }
    }
  }

  std::string mPath;
  int mFd;
  mozilla::Mutex mMutex{"SpeculumSupervisorLink"};
  std::atomic<bool> mStopRead{false};
  std::thread mReadThread;
};

class DirectoryLink final : public SpeculumSupervisorLink {
 public:
  explicit DirectoryLink(std::string aDir) : mDir(std::move(aDir)) {}

  void DeliverFrame(uint32_t aContextId, uint64_t aDocToken,
                    uint32_t aSequence, base::ProcessId aChildPid,
                    nsTArray<uint8_t>& aFrame) override {
    const uint32_t ordem = ++mOrder;
    char name[128];
    snprintf(name, sizeof(name), "f-%04u-ctx%u-seq%u.bin", ordem, aContextId,
             aSequence);
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", mDir.c_str(), name);
    if (FILE* fp = fopen(path, "wb")) {
      (void)fwrite(aFrame.Elements(), 1, aFrame.Length(), fp);
      fclose(fp);
    }

    char ndpath[512];
    snprintf(ndpath, sizeof(ndpath), "%s/frames.ndjson", mDir.c_str());
    if (FILE* nd = fopen(ndpath, "a")) {
      fprintf(nd,
              "{\"ordem\":%u,\"childPid\":%u,\"docToken\":%llu,\"contextId\":%u,"
              "\"sequence\":%u,\"bytes\":%zu}\n",
              ordem, static_cast<unsigned>(aChildPid),
              static_cast<unsigned long long>(aDocToken), aContextId, aSequence,
              static_cast<size_t>(aFrame.Length()));
      fclose(nd);
    }
  }

 private:
  std::string mDir;
  uint32_t mOrder = 0;
};

SpeculumSupervisorLink* CreateLink() {
  const char* sockEnv = getenv("SPECULUM_BROWSER_SOCKET");
  if (sockEnv && sockEnv[0]) {
    return new SocketLink(std::string(sockEnv));
  }
  const char* dirEnv = getenv("SPECULUM_FRAME_DIR");
  if (dirEnv && dirEnv[0]) {
    return new DirectoryLink(std::string(dirEnv));
  }
  return new NullLink();
}

mozilla::UniquePtr<SpeculumSupervisorLink> sLink;
bool sInitialized = false;

}  // namespace

void InitSpeculumSupervisorLink() {
  if (!XRE_IsParentProcess()) {
    return;
  }
  if (sInitialized) {
    return;
  }
  sLink.reset(CreateLink());
  sInitialized = true;
}

SpeculumSupervisorLink& GetSpeculumSupervisorLink() {
  if (!sInitialized) {
    InitSpeculumSupervisorLink();
  }
  return *sLink;
}
