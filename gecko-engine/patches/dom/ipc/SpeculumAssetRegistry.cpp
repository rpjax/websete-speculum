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
#include "nsIEncodedChannel.h"
#include "nsIHttpChannel.h"
#include "nsIInputStream.h"
#include "nsILoadInfo.h"
#include "nsIObserver.h"
#include "nsIObserverService.h"
#include "nsIPrincipal.h"
#include "nsIRequest.h"
#include "nsIStreamListener.h"
#include "nsITraceableChannel.h"
#include "nsIPrincipal.h"
#include "nsIURI.h"
#include "nsNetUtil.h"
#include "mozilla/dom/BrowsingContext.h"
#include "nsServiceManagerUtils.h"
#include "nsReadableUtils.h"
#include "nsString.h"
#include "nsStringStream.h"
#include "nsThreadUtils.h"

#include "brotli/decode.h"
#include "zlib.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
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

constexpr const char* kAssetTracePath = "/tmp/speculum-asset-trace.ndjson";

int64_t TraceNowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(system_clock::now().time_since_epoch())
      .count();
}

std::string JsonEscape(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') {
      o.push_back('\\');
      o.push_back(static_cast<char>(c));
    } else if (c < 0x20) {
      char buf[8];
      snprintf(buf, sizeof(buf), "\\u%04x", c);
      o += buf;
    } else {
      o.push_back(static_cast<char>(c));
    }
  }
  return o;
}

std::string BodyFnv16(const uint8_t* p, size_t n) {
  uint64_t h = 14695981039346656037ull;
  for (size_t i = 0; i < n; ++i) {
    h ^= p[i];
    h *= 1099511628211ull;
  }
  char buf[17];
  snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(h));
  return std::string(buf);
}

std::string BodyHeadAscii(const uint8_t* p, size_t n) {
  size_t m = std::min<size_t>(n, 64);
  std::string s;
  s.reserve(m);
  for (size_t i = 0; i < m; ++i) {
    char c = static_cast<char>(p[i]);
    s.push_back((c >= 32 && c < 127) ? c : '.');
  }
  return s;
}

std::string BodyHeadHex(const uint8_t* p, size_t n) {
  size_t m = std::min<size_t>(n, 16);
  static const char* kHex = "0123456789abcdef";
  std::string s;
  s.reserve(m * 2);
  for (size_t i = 0; i < m; ++i) {
    s.push_back(kHex[(p[i] >> 4) & 0xf]);
    s.push_back(kHex[p[i] & 0xf]);
  }
  return s;
}

struct ChannelEncMeta {
  std::string contentType;
  std::string contentEncoding;
  std::string contentCharset;
  std::string applyConversion;  // "1" | "0" | ""
};

ChannelEncMeta ProbeChannelEnc(nsIRequest* aRequest) {
  ChannelEncMeta m;
  if (!aRequest) {
    return m;
  }
  if (nsCOMPtr<nsIChannel> ch = do_QueryInterface(aRequest)) {
    nsAutoCString ct;
    if (NS_SUCCEEDED(ch->GetContentType(ct))) {
      m.contentType.assign(ct.BeginReading(), ct.Length());
    }
    nsAutoCString cs;
    if (NS_SUCCEEDED(ch->GetContentCharset(cs))) {
      m.contentCharset.assign(cs.BeginReading(), cs.Length());
    }
  }
  if (nsCOMPtr<nsIHttpChannel> http = do_QueryInterface(aRequest)) {
    nsAutoCString enc;
    if (NS_SUCCEEDED(http->GetResponseHeader("Content-Encoding"_ns, enc))) {
      m.contentEncoding.assign(enc.BeginReading(), enc.Length());
    }
  }
  // nsIEncodedChannel — ApplyConversion diz se o pipe ainda vai decodificar.
  if (nsCOMPtr<nsIEncodedChannel> encCh = do_QueryInterface(aRequest)) {
    bool apply = true;
    if (NS_SUCCEEDED(encCh->GetApplyConversion(&apply))) {
      m.applyConversion = apply ? "1" : "0";
    }
  }
  return m;
}

bool UrlWorthTracing(const nsACString& aUrl) {
  nsAutoCString lower(aUrl);
  ToLowerCase(lower);
  if (FindInReadable("logo.svg"_ns, lower)) {
    return true;
  }
  const char* env = getenv("SPECULUM_ASSET_TRACE");
  return env && env[0] && strcmp(env, "0") != 0;
}

void TraceNdjson(const std::string& line) {
  FILE* f = fopen(kAssetTracePath, "a");
  if (!f) {
    return;
  }
  fwrite(line.data(), 1, line.size(), f);
  fputc('\n', f);
  fclose(f);
  SPECULUM_LOG("asset-trace %s", line.c_str());
}

void SplitKey(const std::string& key, uint32_t* ctx, std::string* url,
              std::string* range) {
  size_t n1 = key.find('\n');
  size_t n2 = n1 == std::string::npos ? std::string::npos : key.find('\n', n1 + 1);
  *ctx = n1 == std::string::npos
             ? 0
             : static_cast<uint32_t>(strtoul(key.substr(0, n1).c_str(), nullptr, 10));
  *url = n1 == std::string::npos
             ? key
             : key.substr(n1 + 1, n2 == std::string::npos ? std::string::npos
                                                          : n2 - n1 - 1);
  *range = n2 == std::string::npos ? "" : key.substr(n2 + 1);
}

void TraceJoin(uint32_t ctx, uint32_t streamId, const nsACString& url,
               const nsACString& range, const char* path, bool teeExisted,
               bool teeComplete, bool teeFailed, size_t teeByteLen,
               const std::string& teeMime, const char* deniedWhy) {
  if (!UrlWorthTracing(url)) {
    return;
  }
  std::string line = "{\"t\":";
  line += std::to_string(TraceNowMs());
  line += ",\"hop\":\"gecko.join\",\"streamId\":";
  line += std::to_string(streamId);
  line += ",\"contextId\":";
  line += std::to_string(ctx);
  line += ",\"url\":\"";
  line += JsonEscape(std::string(url.BeginReading(), url.Length()));
  line += "\",\"range\":\"";
  line += JsonEscape(std::string(range.BeginReading(), range.Length()));
  line += "\",\"path\":\"";
  line += path;
  line += "\",\"teeExisted\":";
  line += teeExisted ? "true" : "false";
  line += ",\"teeComplete\":";
  line += teeComplete ? "true" : "false";
  line += ",\"teeFailed\":";
  line += teeFailed ? "true" : "false";
  line += ",\"teeByteLen\":";
  line += std::to_string(teeByteLen);
  line += ",\"teeMime\":\"";
  line += JsonEscape(teeMime);
  line += "\"";
  if (deniedWhy) {
    line += ",\"deniedWhy\":\"";
    line += JsonEscape(deniedWhy);
    line += "\"";
  }
  line += "}";
  TraceNdjson(line);
}

void TraceTeeEvent(const std::string& key, const char* event, uint64_t offset,
                   uint32_t chunkLen, size_t byteLenAfter,
                   const std::string& channelCt,
                   const std::string& contentEncoding = {},
                   const std::string& contentCharset = {},
                   const std::string& applyConversion = {},
                   const std::string& dataHeadHex = {}) {
  uint32_t ctx = 0;
  std::string url;
  std::string range;
  SplitKey(key, &ctx, &url, &range);
  nsAutoCString u(url.c_str());
  if (!UrlWorthTracing(u)) {
    return;
  }
  std::string line = "{\"t\":";
  line += std::to_string(TraceNowMs());
  line += ",\"hop\":\"gecko.tee\",\"contextId\":";
  line += std::to_string(ctx);
  line += ",\"url\":\"";
  line += JsonEscape(url);
  line += "\",\"range\":\"";
  line += JsonEscape(range);
  line += "\",\"event\":\"";
  line += event;
  line += "\",\"offset\":";
  line += std::to_string(offset);
  line += ",\"chunkLen\":";
  line += std::to_string(chunkLen);
  line += ",\"byteLenAfter\":";
  line += std::to_string(byteLenAfter);
  line += ",\"channelContentType\":\"";
  line += JsonEscape(channelCt);
  line += "\",\"contentEncoding\":\"";
  line += JsonEscape(contentEncoding);
  line += "\",\"contentCharset\":\"";
  line += JsonEscape(contentCharset);
  line += "\",\"applyConversion\":\"";
  line += JsonEscape(applyConversion);
  line += "\",\"dataHeadHex\":\"";
  line += JsonEscape(dataHeadHex);
  line += "\"}";
  TraceNdjson(line);
}

void TraceEmit(uint32_t ctx, uint32_t streamId, const std::string& url,
               const std::string& range, const char* phase, uint64_t offset,
               uint32_t dataLen, const std::string& mime,
               const std::string& bodySha16, const std::string& bodyHead,
               const std::string& bodyHeadHex, bool sniffApplied,
               bool emptyImageDenied, const char* why) {
  nsAutoCString u(url.c_str());
  if (!UrlWorthTracing(u)) {
    return;
  }
  std::string line = "{\"t\":";
  line += std::to_string(TraceNowMs());
  line += ",\"hop\":\"gecko.emit\",\"streamId\":";
  line += std::to_string(streamId);
  line += ",\"contextId\":";
  line += std::to_string(ctx);
  line += ",\"url\":\"";
  line += JsonEscape(url);
  line += "\",\"range\":\"";
  line += JsonEscape(range);
  line += "\",\"phase\":\"";
  line += phase;
  line += "\",\"offset\":";
  line += std::to_string(offset);
  line += ",\"dataLen\":";
  line += std::to_string(dataLen);
  line += ",\"mimeOnComplete\":\"";
  line += JsonEscape(mime);
  line += "\",\"bodySha16\":\"";
  line += bodySha16;
  line += "\",\"bodyHead\":\"";
  line += JsonEscape(bodyHead);
  line += "\",\"bodyHeadHex\":\"";
  line += JsonEscape(bodyHeadHex);
  line += "\",\"sniffApplied\":";
  line += sniffApplied ? "true" : "false";
  line += ",\"emptyImageDenied\":";
  line += emptyImageDenied ? "true" : "false";
  if (why) {
    line += ",\"why\":\"";
    line += JsonEscape(why);
    line += "\"";
  }
  line += "}";
  TraceNdjson(line);
}

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

struct PendingReader {
  uint32_t contextId = 0;
  uint32_t streamId = 0;
  uint64_t offset = 0;
  SpeculumAssetRegistry::Emit emit;
};

struct TeeBody {
  std::vector<uint8_t> bytes;
  std::string mime;
  std::string contentEncoding;  // wire encoding; Virtual child still decodes
  bool complete = false;
  bool failed = false;
  bool logical = false;  // bytes are post-Content-Encoding
  std::vector<PendingReader> waiters;
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
                uint32_t aStreamId, const char* aWhy, const std::string& aKey = {}) {
  EmitWire(aEmit, aContextId, aStreamId, kPhaseDenied, 0,
           reinterpret_cast<const uint8_t*>(aWhy),
           static_cast<uint32_t>(strlen(aWhy)));
  if (!aKey.empty()) {
    uint32_t ctx = 0;
    std::string url;
    std::string range;
    SplitKey(aKey, &ctx, &url, &range);
    TraceEmit(aContextId, aStreamId, url, range, "denied", 0, 0, "", "", "", "",
              false, strcmp(aWhy, "empty-image") == 0, aWhy);
  }
}

/** Chromium recusa SVG sem Content-Type útil (nw=0). Sniff se mime vazio, genérico ou não-image. */
bool MimeNeedsSniff(const std::string& aMime) {
  if (aMime.empty()) {
    return true;
  }
  // Gecko / proxies frequentemente caem nestes quando o CDN omite tipo.
  if (aMime == "application/octet-stream" || aMime == "binary/octet-stream" ||
      aMime == "text/plain" || aMime == "application/force-download" ||
      aMime == "text/html") {
    return true;
  }
  // Content-Type com parâmetros (ex. charset) — compara o tipo base.
  const size_t semi = aMime.find(';');
  const std::string base =
      semi == std::string::npos ? aMime : aMime.substr(0, semi);
  if (base.rfind("image/", 0) != 0) {
    return true;
  }
  return false;
}

void EnsureMime(TeeBody& aBody) {
  if (aBody.bytes.empty() || !MimeNeedsSniff(aBody.mime)) {
    return;
  }
  size_t i = 0;
  while (i < aBody.bytes.size() &&
         (aBody.bytes[i] == ' ' || aBody.bytes[i] == '\n' ||
          aBody.bytes[i] == '\r' || aBody.bytes[i] == '\t')) {
    ++i;
  }
  if (i >= aBody.bytes.size()) {
    return;
  }
  const uint8_t* p = aBody.bytes.data() + i;
  const size_t n = aBody.bytes.size() - i;
  if (n >= 3 && p[0] == 0xff && p[1] == 0xd8 && p[2] == 0xff) {
    aBody.mime = "image/jpeg";
    return;
  }
  if (n >= 8 && p[0] == 0x89 && p[1] == 'P' && p[2] == 'N' && p[3] == 'G') {
    aBody.mime = "image/png";
    return;
  }
  if (n >= 12 && p[0] == 'R' && p[1] == 'I' && p[2] == 'F' && p[3] == 'F' &&
      p[8] == 'W' && p[9] == 'E' && p[10] == 'B' && p[11] == 'P') {
    aBody.mime = "image/webp";
    return;
  }
  if (n >= 3 && p[0] == 'G' && p[1] == 'I' && p[2] == 'F') {
    aBody.mime = "image/gif";
    return;
  }
  if (n >= 5 && p[0] == '<') {
    std::string head(reinterpret_cast<const char*>(p),
                     std::min<size_t>(n, 256));
    for (char& c : head) {
      if (c >= 'A' && c <= 'Z') {
        c = static_cast<char>(c - 'A' + 'a');
      }
    }
    if (head.find("<svg") != std::string::npos ||
        head.find("<!doctype svg") != std::string::npos) {
      aBody.mime = "image/svg+xml";
    }
  }
}

bool LooksLogicalImage(const std::vector<uint8_t>& bytes) {
  if (bytes.size() < 3) {
    return false;
  }
  const uint8_t* p = bytes.data();
  if (p[0] == 0xff && p[1] == 0xd8) {
    return true;
  }
  if (p[0] == 0x89 && p[1] == 'P' && p[2] == 'N' && p[3] == 'G') {
    return true;
  }
  if (p[0] == 'G' && p[1] == 'I' && p[2] == 'F') {
    return true;
  }
  if (bytes.size() >= 12 && p[0] == 'R' && p[8] == 'W' && p[9] == 'E' &&
      p[10] == 'B' && p[11] == 'P') {
    return true;
  }
  size_t i = 0;
  while (i < bytes.size() &&
         (bytes[i] == ' ' || bytes[i] == '\n' || bytes[i] == '\r' ||
          bytes[i] == '\t')) {
    ++i;
  }
  if (i >= bytes.size() || bytes[i] != '<') {
    return false;
  }
  std::string head(reinterpret_cast<const char*>(bytes.data() + i),
                   std::min<size_t>(bytes.size() - i, 256));
  for (char& c : head) {
    if (c >= 'A' && c <= 'Z') {
      c = static_cast<char>(c - 'A' + 'a');
    }
  }
  return head.find("<svg") != std::string::npos ||
         head.find("<?xml") != std::string::npos ||
         head.find("<!doctype svg") != std::string::npos;
}

bool DecodeBrotliInPlace(std::vector<uint8_t>& bytes) {
  BrotliDecoderState* state =
      BrotliDecoderCreateInstance(nullptr, nullptr, nullptr);
  if (!state) {
    return false;
  }
  std::vector<uint8_t> out;
  out.reserve(bytes.size() * 4);
  size_t available_in = bytes.size();
  const uint8_t* next_in = bytes.data();
  BrotliDecoderResult result;
  do {
    uint8_t buf[16384];
    size_t available_out = sizeof(buf);
    uint8_t* next_out = buf;
    result = BrotliDecoderDecompressStream(state, &available_in, &next_in,
                                           &available_out, &next_out, nullptr);
    const size_t produced = sizeof(buf) - available_out;
    if (produced) {
      out.insert(out.end(), buf, buf + produced);
    }
    if (out.size() > 64u * 1024u * 1024u) {
      BrotliDecoderDestroyInstance(state);
      return false;
    }
  } while (result == BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT);
  BrotliDecoderDestroyInstance(state);
  if (result != BROTLI_DECODER_RESULT_SUCCESS) {
    return false;
  }
  bytes.swap(out);
  return true;
}

bool DecodeGzipInPlace(std::vector<uint8_t>& bytes, bool rawDeflate) {
  z_stream strm{};
  const int windowBits = rawDeflate ? -MAX_WBITS : (MAX_WBITS + 16);
  if (inflateInit2(&strm, windowBits) != Z_OK) {
    return false;
  }
  strm.next_in = const_cast<Bytef*>(bytes.data());
  strm.avail_in = static_cast<uInt>(bytes.size());
  std::vector<uint8_t> out;
  out.reserve(bytes.size() * 4);
  int ret;
  do {
    uint8_t buf[16384];
    strm.next_out = buf;
    strm.avail_out = sizeof(buf);
    ret = inflate(&strm, Z_NO_FLUSH);
    const size_t produced = sizeof(buf) - strm.avail_out;
    if (produced) {
      out.insert(out.end(), buf, buf + produced);
    }
    if (out.size() > 64u * 1024u * 1024u) {
      inflateEnd(&strm);
      return false;
    }
  } while (ret == Z_OK);
  inflateEnd(&strm);
  if (ret != Z_STREAM_END) {
    return false;
  }
  bytes.swap(out);
  return true;
}

/**
 * Parent-side tee sees Content-Encoding wire bytes (HttpChannelParent disables
 * ApplyConversion so the child decodes). Speculum emit needs logical octets.
 * Decode a side copy into TeeBody; mNext still gets the compressed stream.
 */
void EnsureLogicalBody(TeeBody& aBody, const std::string& aKey) {
  if (aBody.logical || aBody.bytes.empty()) {
    aBody.logical = true;
    return;
  }
  if (LooksLogicalImage(aBody.bytes)) {
    aBody.logical = true;
    return;
  }
  nsAutoCString enc(aBody.contentEncoding.c_str());
  ToLowerCase(enc);
  if (enc.IsEmpty()) {
    aBody.logical = true;
    return;
  }
  const size_t before = aBody.bytes.size();
  bool ok = false;
  const char* how = "none";
  // Encodings listed in apply order; undo last first (RFC 9110).
  nsAutoCString last(enc);
  const int32_t comma = last.RFind(",");
  if (comma >= 0) {
    last.Cut(0, comma + 1);
  }
  last.Trim(" \t");
  if (last.EqualsLiteral("br")) {
    ok = DecodeBrotliInPlace(aBody.bytes);
    how = "br";
  } else if (last.EqualsLiteral("gzip") || last.EqualsLiteral("x-gzip")) {
    ok = DecodeGzipInPlace(aBody.bytes, false);
    how = "gzip";
  } else if (last.EqualsLiteral("deflate")) {
    ok = DecodeGzipInPlace(aBody.bytes, true);
    how = "deflate";
  }
  if (ok) {
    aBody.logical = true;
    TraceTeeEvent(aKey, "decode_ok", 0, static_cast<uint32_t>(before),
                  aBody.bytes.size(), aBody.mime, aBody.contentEncoding, "",
                  how, BodyHeadHex(aBody.bytes.data(), aBody.bytes.size()));
  } else {
    TraceTeeEvent(aKey, "decode_fail", 0, static_cast<uint32_t>(before), before,
                  aBody.mime, aBody.contentEncoding, "", how,
                  BodyHeadHex(aBody.bytes.data(), aBody.bytes.size()));
  }
}

void EmitFromBody(const SpeculumAssetRegistry::Emit& aEmit, uint32_t aContextId,
                  uint32_t aStreamId, uint64_t aOffset, TeeBody& aBody,
                  const std::string& aKey) {
  uint32_t ctx = 0;
  std::string url;
  std::string range;
  SplitKey(aKey, &ctx, &url, &range);
  if (aBody.failed) {
    EmitDenied(aEmit, aContextId, aStreamId, "channel-failed", aKey);
    return;
  }
  if (!aBody.complete) {
    EmitDenied(aEmit, aContextId, aStreamId, "incomplete", aKey);
    return;
  }
  EnsureLogicalBody(aBody, aKey);
  const std::string mimeBefore = aBody.mime;
  EnsureMime(aBody);
  const bool sniffApplied = mimeBefore != aBody.mime;
  if (aOffset > aBody.bytes.size()) {
    EmitDenied(aEmit, aContextId, aStreamId, "offset-past-end", aKey);
    return;
  }
  const uint32_t left =
      static_cast<uint32_t>(aBody.bytes.size() - static_cast<size_t>(aOffset));
  // Imagem vazia como 200 → Chromium cacheia decode falho (nw=0) pra URL.
  if (left == 0 && aBody.mime.rfind("image/", 0) == 0) {
    EmitDenied(aEmit, aContextId, aStreamId, "empty-image", aKey);
    return;
  }
  const uint8_t* bodyPtr =
      left > 0 ? aBody.bytes.data() + static_cast<size_t>(aOffset) : nullptr;
  const std::string sha =
      bodyPtr ? BodyFnv16(bodyPtr, left) : BodyFnv16(nullptr, 0);
  const std::string head = bodyPtr ? BodyHeadAscii(bodyPtr, left) : "";
  const std::string headHex = bodyPtr ? BodyHeadHex(bodyPtr, left) : "";
  if (left > 0) {
    EmitWire(aEmit, aContextId, aStreamId, kPhaseChunk, aOffset,
             aBody.bytes.data() + aOffset, left);
    TraceEmit(aContextId, aStreamId, url, range, "chunk", aOffset, left,
              aBody.mime, sha, head, headHex, sniffApplied, false, nullptr);
  }
  const auto* mime = aBody.mime.empty()
                         ? nullptr
                         : reinterpret_cast<const uint8_t*>(aBody.mime.data());
  EmitWire(aEmit, aContextId, aStreamId, kPhaseComplete,
           static_cast<uint64_t>(aBody.bytes.size()), mime,
           static_cast<uint32_t>(aBody.mime.size()));
  TraceEmit(aContextId, aStreamId, url, range, "complete",
            static_cast<uint64_t>(aBody.bytes.size()), left, aBody.mime, sha,
            head, headHex, sniffApplied, false, nullptr);
}

void NoteMime(const std::string& aKey, nsIRequest* aRequest) {
  ChannelEncMeta meta = ProbeChannelEnc(aRequest);
  TeeBody& body = State().Ensure(aKey);
  if (!meta.contentType.empty()) {
    body.mime = meta.contentType;
  }
  if (!meta.contentEncoding.empty() && body.contentEncoding.empty()) {
    body.contentEncoding = meta.contentEncoding;
  }
}

void FlushWaiters(const std::string& aKey) {
  TeeBody* body = State().Find(aKey);
  if (!body || (!body->complete && !body->failed)) {
    return;
  }
  EnsureLogicalBody(*body, aKey);
  EnsureMime(*body);
  std::vector<PendingReader> waiters = std::move(body->waiters);
  for (PendingReader& w : waiters) {
    EmitFromBody(w.emit, w.contextId, w.streamId, w.offset, *body, aKey);
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

nsContentPolicyType PolicyOf(SpeculumAssetDest aDest) {
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
OpenListener::OnStartRequest(nsIRequest* aRequest) {
  NoteMime(mKey, aRequest);
  ChannelEncMeta meta = ProbeChannelEnc(aRequest);
  TeeBody* body = State().Find(mKey);
  TraceTeeEvent(mKey, "open_start", 0, 0, body ? body->bytes.size() : 0,
                meta.contentType, meta.contentEncoding, meta.contentCharset,
                meta.applyConversion);
  return NS_OK;
}

NS_IMETHODIMP
OpenListener::OnStopRequest(nsIRequest* aRequest, nsresult aStatus) {
  NoteMime(mKey, aRequest);
  AppendTee(mKey, 0, nullptr, 0, NS_SUCCEEDED(aStatus), NS_FAILED(aStatus));
  TeeBody* body = State().Find(mKey);
  TraceTeeEvent(mKey, NS_SUCCEEDED(aStatus) ? "open_stop_ok" : "open_stop_fail",
                0, 0, body ? body->bytes.size() : 0, body ? body->mime : "");
  if (!body || body->failed) {
    EmitDenied(mEmit, mContextId, mStreamId, "open-failed", mKey);
    FlushWaiters(mKey);
    return NS_OK;
  }
  EmitFromBody(mEmit, mContextId, mStreamId, mOffset, *body, mKey);
  FlushWaiters(mKey);
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
  TeeBody* body = State().Find(mKey);
  TraceTeeEvent(mKey, "open_data", aOffset, read, body ? body->bytes.size() : 0,
                "", "", "", "", BodyHeadHex(chunk.Elements(), read));
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
  NoteMime(mKey, aRequest);
  ChannelEncMeta meta = ProbeChannelEnc(aRequest);
  TeeBody* body = State().Find(mKey);
  TraceTeeEvent(mKey, "tap_start", 0, 0, body ? body->bytes.size() : 0,
                meta.contentType, meta.contentEncoding, meta.contentCharset,
                meta.applyConversion);
  return mNext ? mNext->OnStartRequest(aRequest) : NS_OK;
}

NS_IMETHODIMP
TeeTap::OnStopRequest(nsIRequest* aRequest, nsresult aStatus) {
  NoteMime(mKey, aRequest);
  AppendTee(mKey, 0, nullptr, 0, NS_SUCCEEDED(aStatus), NS_FAILED(aStatus));
  TeeBody* body = State().Find(mKey);
  TraceTeeEvent(mKey, NS_SUCCEEDED(aStatus) ? "tap_stop_ok" : "tap_stop_fail", 0,
                0, body ? body->bytes.size() : 0, body ? body->mime : "");
  FlushWaiters(mKey);
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
  TeeBody* body = State().Find(mKey);
  TraceTeeEvent(mKey, "tap_data", aOffset, read, body ? body->bytes.size() : 0,
                "", "", "", "", BodyHeadHex(chunk.Elements(), read));
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
  TeeBody& ensured = State().Ensure(key);
  ChannelEncMeta meta = ProbeChannelEnc(channel);
  if (!meta.contentType.empty()) {
    ensured.mime = meta.contentType;
  }
  if (!meta.contentEncoding.empty()) {
    ensured.contentEncoding = meta.contentEncoding;
  }
  TraceTeeEvent(key, "ensure", 0, 0, 0, meta.contentType, meta.contentEncoding,
                meta.contentCharset, meta.applyConversion);
  nsCOMPtr<nsITraceableChannel> trace = do_QueryInterface(channel);
  if (!trace) {
    TraceTeeEvent(key, "tap_attach_fail", 0, 0, 0, "no-traceable",
                  meta.contentEncoding, meta.contentCharset,
                  meta.applyConversion);
    return NS_OK;
  }
  nsCOMPtr<nsIStreamListener> old;
  RefPtr<TeeTap> tap = new TeeTap(nullptr, key);
  if (NS_FAILED(trace->SetNewListener(tap, true, getter_AddRefs(old)))) {
    TraceTeeEvent(key, "tap_attach_fail", 0, 0, 0, "SetNewListener",
                  meta.contentEncoding, meta.contentCharset,
                  meta.applyConversion);
    return NS_OK;
  }
  tap->SetNext(old);
  TraceTeeEvent(key, "tap_attach_ok", 0, 0, 0, meta.contentType,
                meta.contentEncoding, meta.contentCharset,
                meta.applyConversion);
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
    TraceJoin(aContextId, msg.streamId, url, range, "denied_pre", false, false,
              false, 0, "", "denied");
    return;
  }

  const std::string key = KeyOf(aContextId, url, range);
  if (TeeBody* existing = State().Find(key)) {
    if (existing->complete) {
      TraceJoin(aContextId, msg.streamId, url, range, "emit_complete", true,
                true, existing->failed, existing->bytes.size(), existing->mime,
                nullptr);
      EmitFromBody(aEmit, aContextId, msg.streamId, msg.offset, *existing, key);
      return;
    }
    if (existing->failed) {
      TraceJoin(aContextId, msg.streamId, url, range, "erase_failed_retry", true,
                false, true, existing->bytes.size(), existing->mime, nullptr);
      // Falha anterior não pode prender o URL pra sempre — retry via open (doc 13).
      State().bodies.erase(key);
    } else {
      TraceJoin(aContextId, msg.streamId, url, range, "wait", true, false, false,
                existing->bytes.size(), existing->mime, nullptr);
      // Tee em voo — espera OnStop (doc 13). Não emitir parcial sem mime/complete
      // (SVG sem Content-Type → nw=0 e alt text estoura o header).
      existing->waiters.push_back(
          PendingReader{aContextId, msg.streamId, msg.offset, aEmit});
      return;
    }
  }

  TraceJoin(aContextId, msg.streamId, url, range, "open", false, false, false, 0,
            "", nullptr);

  nsCOMPtr<nsIURI> uri;
  if (NS_FAILED(NS_NewURI(getter_AddRefs(uri), url)) || !uri) {
    EmitDenied(aEmit, aContextId, msg.streamId, "bad-url", key);
    return;
  }

  nsCOMPtr<nsIPrincipal> principal =
      SpeculumProjectionRuntime::Get().DocumentPrincipalOf(aContextId);
  if (!principal) {
    EmitDenied(aEmit, aContextId, msg.streamId, "no-principal", key);
    return;
  }
  nsCOMPtr<nsIChannel> channel;
  nsresult rv = NS_NewChannel(
      getter_AddRefs(channel), uri, principal,
      nsILoadInfo::SEC_ALLOW_CROSS_ORIGIN_INHERITS_SEC_CONTEXT,
      PolicyOf(dest));
  if (NS_FAILED(rv) || !channel) {
    EmitDenied(aEmit, aContextId, msg.streamId, "open-failed", key);
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
    EmitDenied(aEmit, aContextId, msg.streamId, "open-failed", key);
  }
}
