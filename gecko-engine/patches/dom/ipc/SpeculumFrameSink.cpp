/* Speculum — destino de frames no processo pai (socket supervisor ou devpath). */
#include "SpeculumFrameSink.h"

#include "mozilla/UniquePtr.h"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace {

constexpr uint8_t kKindFrame = 0x01;
constexpr uint8_t kKindHello = 0x03;

void LogSinkErr(const char* aMsg) {
  fprintf(stderr, "[SPECULUM-SINK-ERR] %s\n", aMsg);
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

class NullSink final : public SpeculumFrameSink {
 public:
  void DeliverFrame(uint32_t, uint64_t, uint32_t, base::ProcessId,
                    nsTArray<uint8_t>&) override {}
};

class SocketSink final : public SpeculumFrameSink {
 public:
  explicit SocketSink(std::string aPath) : mPath(std::move(aPath)), mFd(-1) {}

  ~SocketSink() override {
    if (mFd >= 0) {
      close(mFd);
      mFd = -1;
    }
  }

  void DeliverFrame(uint32_t aContextId, uint64_t, uint32_t, base::ProcessId,
                    nsTArray<uint8_t>& aFrame) override {
    if (!EnsureConnected()) {
      return;
    }
    const uint32_t len = static_cast<uint32_t>(aFrame.Length());
    if (!SendEnvelope(mFd, kKindFrame, aContextId, aFrame.Elements(), len)) {
      LogSinkErr("socket write failed");
      close(mFd);
      mFd = -1;
    }
  }

 private:
  bool EnsureConnected() {
    if (mFd >= 0) {
      return true;
    }
    const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
      LogSinkErr("socket create failed");
      return false;
    }
    sockaddr_un addr {};
    if (mPath.size() >= sizeof(addr.sun_path)) {
      LogSinkErr("socket path too long");
      close(fd);
      return false;
    }
    addr.sun_family = AF_UNIX;
    memcpy(addr.sun_path, mPath.c_str(), mPath.size() + 1);
    if (connect(fd, reinterpret_cast<sockaddr*>(&addr),
                sizeof(addr)) != 0) {
      LogSinkErr("socket connect failed");
      close(fd);
      return false;
    }
    if (!SendEnvelope(fd, kKindHello, 0, nullptr, 0)) {
      LogSinkErr("hello send failed");
      close(fd);
      return false;
    }
    mFd = fd;
    return true;
  }

  std::string mPath;
  int mFd;
};

class DirectorySink final : public SpeculumFrameSink {
 public:
  explicit DirectorySink(std::string aDir) : mDir(std::move(aDir)) {}

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

SpeculumFrameSink* CreateSink() {
  const char* sockEnv = getenv("SPECULUM_BROWSER_SOCKET");
  if (sockEnv && sockEnv[0]) {
    return new SocketSink(std::string(sockEnv));
  }
  const char* dirEnv = getenv("SPECULUM_FRAME_DIR");
  if (dirEnv && dirEnv[0]) {
    return new DirectorySink(std::string(dirEnv));
  }
  return new NullSink();
}

}  // namespace

SpeculumFrameSink& GetSpeculumFrameSink() {
  static mozilla::UniquePtr<SpeculumFrameSink> sSink;
  static bool sInitialized = false;
  if (!sInitialized) {
    sSink.reset(CreateSink());
    sInitialized = true;
  }
  return *sSink;
}
