/* Speculum — registro de canal no pai. Tee por offset. Recusa se não pode sair. */
#include "SpeculumAssetRegistry.h"

#include "SpeculumAssetClassifier.h"
#include "SpeculumLog.h"
#include "SpeculumProjectionRuntime.h"
#include "mozilla/ClearOnShutdown.h"
#include "mozilla/Span.h"
#include "mozilla/StaticPtr.h"
#include "nsIChannel.h"
#include "nsIContentPolicy.h"
#include "nsIHttpChannel.h"
#include "nsIInputStream.h"
#include "nsILoadInfo.h"
#include "nsIObserver.h"
#include "nsIObserverService.h"
#include "nsIPrincipal.h"
#include "nsIStreamListener.h"
#include "nsITraceableChannel.h"
#include "nsIPrincipal.h"
#include "nsIURI.h"
#include "nsNetUtil.h"
#include "mozilla/dom/BrowsingContext.h"
#include "nsServiceManagerUtils.h"
#include "nsString.h"
#include "nsThreadUtils.h"

#include <cstring>
#include <map>
#include <string>
#include <vector>

using mozilla::StaticAutoPtr;

namespace {

constexpr uint8_t kPhaseRequest = 0;
constexpr uint8_t kPhaseChunk = 1;
constexpr uint8_t kPhaseDenied = 2;
constexpr uint8_t kPhaseComplete = 3;

std::string KeyOf(uint32_t aContextId, const nsACString& aUrl,
                  const nsACString& aRange) {
  std::string key;
  key += std::to_string(aContextId);
  key += '\n';
  key.append(aUrl.BeginReading(), aUrl.Length());
  key += '\n';
  key.append(aRange.BeginReading(), aRange.Length());
  return key;
}

struct TeeBody {
  std::vector<uint8_t> bytes;
  bool complete = false;
  bool failed = false;
};

class RegistryState {
 public:
  std::map<std::string, TeeBody> bodies;

  TeeBody* Find(const std::string& aKey) {
    auto it = bodies.find(aKey);
    return it == bodies.end() ? nullptr : &it->second;
  }

  TeeBody& Ensure(const std::string& aKey) { return bodies[aKey]; }
};

RegistryState& State() {
  static RegistryState s;
  return s;
}

void EmitWire(const SpeculumAssetRegistry::Emit& aEmit, uint32_t aContextId,
              uint32_t aStreamId, uint8_t aPhase, uint64_t aOffset,
              const uint8_t* aData, uint32_t aLen) {
  nsTArray<uint8_t> wire;
  SpeculumAssetEncodeWire(aStreamId, aPhase, aOffset, aData, aLen, wire);
  aEmit(aContextId, wire.Elements(), wire.Length());
}

void EmitDenied(const SpeculumAssetRegistry::Emit& aEmit, uint32_t aContextId,
                uint32_t aStreamId, const char* aWhy) {
  EmitWire(aEmit, aContextId, aStreamId, kPhaseDenied, 0,
           reinterpret_cast<const uint8_t*>(aWhy),
           static_cast<uint32_t>(strlen(aWhy)));
}

void EmitFromBody(const SpeculumAssetRegistry::Emit& aEmit, uint32_t aContextId,
                  uint32_t aStreamId, uint64_t aOffset, const TeeBody& aBody) {
  if (aBody.failed) {
    EmitDenied(aEmit, aContextId, aStreamId, "channel-failed");
    return;
  }
  if (aOffset > aBody.bytes.size()) {
    EmitDenied(aEmit, aContextId, aStreamId, "offset-past-end");
    return;
  }
  const uint32_t left =
      static_cast<uint32_t>(aBody.bytes.size() - static_cast<size_t>(aOffset));
  if (left > 0) {
    EmitWire(aEmit, aContextId, aStreamId, kPhaseChunk, aOffset,
             aBody.bytes.data() + aOffset, left);
  }
  if (aBody.complete) {
    EmitWire(aEmit, aContextId, aStreamId, kPhaseComplete,
             static_cast<uint64_t>(aBody.bytes.size()), nullptr, 0);
  }
}

void AppendTee(const std::string& aKey, uint64_t aOffset, const uint8_t* aData,
               uint32_t aLength, bool aDone, bool aFailed = false) {
  TeeBody& body = State().Ensure(aKey);
  if (aData && aLength) {
    if (body.bytes.size() < aOffset + aLength) {
      body.bytes.resize(static_cast<size_t>(aOffset + aLength));
    }
    memcpy(body.bytes.data() + aOffset, aData, aLength);
  }
  if (aDone) {
    body.complete = true;
  }
  if (aFailed) {
    body.failed = true;
  }
}

uint32_t PolicyOf(SpeculumAssetDest aDest) {
  switch (aDest) {
    case SpeculumAssetDest::Image:
      return nsIContentPolicy::TYPE_INTERNAL_IMAGE;
    case SpeculumAssetDest::Font:
      return nsIContentPolicy::TYPE_FONT;
    case SpeculumAssetDest::Audio:
    case SpeculumAssetDest::Video:
    case SpeculumAssetDest::Hls:
      return nsIContentPolicy::TYPE_MEDIA;
    default:
      return nsIContentPolicy::TYPE_OTHER;
  }
}

class OpenListener final : public nsIStreamListener {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIREQUESTOBSERVER
  NS_DECL_NSISTREAMLISTENER

  OpenListener(std::string aKey, uint32_t aContextId, uint32_t aStreamId,
               uint64_t aOffset, SpeculumAssetRegistry::Emit aEmit)
      : mKey(std::move(aKey)),
        mContextId(aContextId),
        mStreamId(aStreamId),
        mOffset(aOffset),
        mEmit(std::move(aEmit)) {}

 private:
  ~OpenListener() = default;

  std::string mKey;
  uint32_t mContextId;
  uint32_t mStreamId;
  uint64_t mOffset;
  SpeculumAssetRegistry::Emit mEmit;
  uint64_t mWrote = 0;
};

NS_IMPL_ISUPPORTS(OpenListener, nsIStreamListener, nsIRequestObserver)

NS_IMETHODIMP
OpenListener::OnStartRequest(nsIRequest*) { return NS_OK; }

NS_IMETHODIMP
OpenListener::OnStopRequest(nsIRequest*, nsresult aStatus) {
  AppendTee(mKey, 0, nullptr, 0, NS_SUCCEEDED(aStatus), NS_FAILED(aStatus));
  TeeBody* body = State().Find(mKey);
  if (!body || body->failed) {
    EmitDenied(mEmit, mContextId, mStreamId, "open-failed");
    return NS_OK;
  }
  EmitFromBody(mEmit, mContextId, mStreamId, mOffset, *body);
  return NS_OK;
}

NS_IMETHODIMP
OpenListener::OnDataAvailable(nsIRequest*, nsIInputStream* aStream,
                              uint64_t aOffset, uint32_t aCount) {
  nsTArray<uint8_t> chunk;
  chunk.SetLength(aCount);
  uint32_t read = 0;
  nsresult rv = aStream->Read(reinterpret_cast<char*>(chunk.Elements()), aCount,
                              &read);
  if (NS_FAILED(rv) || !read) {
    return rv;
  }
  AppendTee(mKey, aOffset, chunk.Elements(), read, false);
  mWrote += read;
  return NS_OK;
}

class TeeTap final : public nsIStreamListener {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIREQUESTOBSERVER
  NS_DECL_NSISTREAMLISTENER

  TeeTap(nsIStreamListener* aNext, std::string aKey)
      : mNext(aNext), mKey(std::move(aKey)) {}

  void SetNext(nsIStreamListener* aNext) { mNext = aNext; }

 private:
  ~TeeTap() = default;
  nsCOMPtr<nsIStreamListener> mNext;
  std::string mKey;
};

NS_IMPL_ISUPPORTS(TeeTap, nsIStreamListener, nsIRequestObserver)

NS_IMETHODIMP
TeeTap::OnStartRequest(nsIRequest* aRequest) {
  return mNext ? mNext->OnStartRequest(aRequest) : NS_OK;
}

NS_IMETHODIMP
TeeTap::OnStopRequest(nsIRequest* aRequest, nsresult aStatus) {
  AppendTee(mKey, 0, nullptr, 0, NS_SUCCEEDED(aStatus), NS_FAILED(aStatus));
  return mNext ? mNext->OnStopRequest(aRequest, aStatus) : NS_OK;
}

NS_IMETHODIMP
TeeTap::OnDataAvailable(nsIRequest* aRequest, nsIInputStream* aStream,
                        uint64_t aOffset, uint32_t aCount) {
  nsTArray<uint8_t> chunk;
  chunk.SetLength(aCount);
  uint32_t read = 0;
  nsresult rv = aStream->Read(reinterpret_cast<char*>(chunk.Elements()), aCount,
                              &read);
  if (NS_FAILED(rv) || !read) {
    return rv;
  }
  AppendTee(mKey, aOffset, chunk.Elements(), read, false);
  if (!mNext) {
    return NS_OK;
  }
  nsCOMPtr<nsIInputStream> replay;
  rv = NS_NewByteInputStream(
      getter_AddRefs(replay),
      mozilla::Span<const char>(reinterpret_cast<const char*>(chunk.Elements()),
                                read),
      NS_ASSIGNMENT_COPY);
  if (NS_FAILED(rv)) {
    return rv;
  }
  return mNext->OnDataAvailable(aRequest, replay, aOffset, read);
}

SpeculumAssetDest DestFromPolicy(uint32_t aType) {
  switch (aType) {
    case nsIContentPolicy::TYPE_INTERNAL_IMAGE:
    case nsIContentPolicy::TYPE_INTERNAL_IMAGE_PRELOAD:
    case nsIContentPolicy::TYPE_INTERNAL_IMAGE_FAVICON:
    case nsIContentPolicy::TYPE_IMAGE:
    case nsIContentPolicy::TYPE_IMAGESET:
      return SpeculumAssetDest::Image;
    case nsIContentPolicy::TYPE_FONT:
    case nsIContentPolicy::TYPE_INTERNAL_FONT_PRELOAD:
      return SpeculumAssetDest::Font;
    case nsIContentPolicy::TYPE_MEDIA:
      return SpeculumAssetDest::Video;
    default:
      return SpeculumAssetDest::Unknown;
  }
}

class ChannelObserver final : public nsIObserver {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIOBSERVER

 private:
  ~ChannelObserver() = default;
};

NS_IMPL_ISUPPORTS(ChannelObserver, nsIObserver)

NS_IMETHODIMP
ChannelObserver::Observe(nsISupports* aSubject, const char* aTopic,
                         const char16_t*) {
  if (!aTopic || strcmp(aTopic, "http-on-examine-response") != 0) {
    return NS_OK;
  }
  nsCOMPtr<nsIChannel> channel = do_QueryInterface(aSubject);
  if (!channel) {
    return NS_OK;
  }
  nsCOMPtr<nsILoadInfo> info = channel->LoadInfo();
  if (!info) {
    return NS_OK;
  }
  const SpeculumAssetDest dest = DestFromPolicy(info->InternalContentPolicyType());
  if (!SpeculumAssetCanExit(dest)) {
    return NS_OK;
  }
  nsCOMPtr<nsIURI> uri;
  channel->GetURI(getter_AddRefs(uri));
  if (!uri) {
    return NS_OK;
  }
  nsAutoCString spec;
  uri->GetSpec(spec);
  nsAutoCString range;
  if (nsCOMPtr<nsIHttpChannel> http = do_QueryInterface(channel)) {
    (void)http->GetRequestHeader("Range"_ns, range);
  }
  const uint32_t ctx = [&]() -> uint32_t {
    RefPtr<mozilla::dom::BrowsingContext> bc = info->GetBrowsingContext();
    return bc ? bc->GetSpeculumContextId() : 0;
  }();
  if (!ctx) {
    return NS_OK;
  }
  const std::string key = KeyOf(ctx, spec, range);
  State().Ensure(key);
  nsCOMPtr<nsITraceableChannel> trace = do_QueryInterface(channel);
  if (!trace) {
    return NS_OK;
  }
  nsCOMPtr<nsIStreamListener> old;
  RefPtr<TeeTap> tap = new TeeTap(nullptr, key);
  if (NS_FAILED(trace->SetNewListener(tap, false, getter_AddRefs(old)))) {
    return NS_OK;
  }
  tap->SetNext(old);
  return NS_OK;
}

void EnsureObserver() {
  static bool sOnce = false;
  if (sOnce) {
    return;
  }
  sOnce = true;
  nsCOMPtr<nsIObserverService> os = mozilla::services::GetObserverService();
  if (!os) {
    return;
  }
  os->AddObserver(new ChannelObserver(), "http-on-examine-response", false);
}

}  // namespace

StaticAutoPtr<SpeculumAssetRegistry> gAssetRegistry;

SpeculumAssetRegistry& SpeculumAssetRegistry::Get() {
  if (!gAssetRegistry) {
    gAssetRegistry = new SpeculumAssetRegistry();
    mozilla::ClearOnShutdown(&gAssetRegistry);
    EnsureObserver();
  }
  return *gAssetRegistry;
}

void SpeculumAssetRegistry::NoteChannelBytes(uint32_t aContextId,
                                             const nsACString& aUrl,
                                             const nsACString& aRange,
                                             uint64_t aOffset,
                                             const uint8_t* aData,
                                             uint32_t aLength, bool aDone) {
  AppendTee(KeyOf(aContextId, aUrl, aRange), aOffset, aData, aLength, aDone);
}

void SpeculumAssetRegistry::OnConsumerRequest(uint32_t aContextId,
                                              const uint8_t* aPayload,
                                              size_t aLength,
                                              const Emit& aEmit) {
  EnsureObserver();
  SpeculumAssetWire msg;
  if (!SpeculumAssetDecodeWire(aPayload, aLength, &msg) ||
      msg.phase != kPhaseRequest) {
    return;
  }

  SpeculumAssetDest dest = SpeculumAssetDest::Unknown;
  nsAutoCString url;
  nsAutoCString range;
  if (!SpeculumAssetDecodeRequest(msg.data, msg.dataLen, &dest, url, range)) {
    EmitDenied(aEmit, aContextId, msg.streamId, "bad-request");
    return;
  }
  if (!SpeculumAssetCanExit(dest)) {
    EmitDenied(aEmit, aContextId, msg.streamId, "denied");
    return;
  }

  const std::string key = KeyOf(aContextId, url, range);
  if (TeeBody* existing = State().Find(key)) {
    if (existing->complete || !existing->bytes.empty()) {
      EmitFromBody(aEmit, aContextId, msg.streamId, msg.offset, *existing);
      return;
    }
  }

  nsCOMPtr<nsIURI> uri;
  if (NS_FAILED(NS_NewURI(getter_AddRefs(uri), url)) || !uri) {
    EmitDenied(aEmit, aContextId, msg.streamId, "bad-url");
    return;
  }

  nsCOMPtr<nsIPrincipal> principal =
      SpeculumProjectionRuntime::Get().DocumentPrincipalOf(aContextId);
  if (!principal) {
    EmitDenied(aEmit, aContextId, msg.streamId, "no-principal");
    return;
  }
  nsCOMPtr<nsIChannel> channel;
  nsresult rv = NS_NewChannel(
      getter_AddRefs(channel), uri, principal,
      nsILoadInfo::SEC_ALLOW_CROSS_ORIGIN_INHERITS_SEC_CONTEXT,
      PolicyOf(dest));
  if (NS_FAILED(rv) || !channel) {
    EmitDenied(aEmit, aContextId, msg.streamId, "open-failed");
    return;
  }
  if (!range.IsEmpty()) {
    if (nsCOMPtr<nsIHttpChannel> http = do_QueryInterface(channel)) {
      (void)http->SetRequestHeader("Range"_ns, range, false);
    }
  }

  nsCOMPtr<nsIStreamListener> listener =
      new OpenListener(key, aContextId, msg.streamId, msg.offset, aEmit);
  rv = channel->AsyncOpen(listener);
  if (NS_FAILED(rv)) {
    EmitDenied(aEmit, aContextId, msg.streamId, "open-failed");
  }
}
