/* Speculum — NodeSource sobre nsINode (produtor PageProjection). */
#include "mozilla/Assertions.h"
#define SPECULUM_FATAL(msg) MOZ_CRASH(msg)
#include "SpeculumNodeSource.h"

#include "AttrArray.h"
#include "DocumentType.h"
#include "Element.h"
#include "NameSpaceConstants.h"
#include "mozilla/dom/CharacterData.h"
#include "nsAttrName.h"
#include "nsAttrValue.h"
#include "nsIContent.h"
#include "nsINode.h"
#include "nsReadableUtils.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/BrowsingContext.h"
#include "nsIDocShell.h"

#include <cstdio>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <string>
#include <vector>

using mozilla::dom::CharacterData;
using mozilla::dom::DocumentType;
using mozilla::dom::Element;

namespace {

nsINode* AsNode(const void* aNode) {
  return const_cast<nsINode*>(static_cast<const nsINode*>(aNode));
}

std::string Utf8FromUtf16(const nsAString& aUtf16) {
  return std::string(NS_ConvertUTF16toUTF8(aUtf16).get());
}

std::string Utf8FromAtom(const nsAtom* aAtom) {
  if (!aAtom) {
    return std::string();
  }
  nsAutoString tmp;
  aAtom->ToString(tmp);
  return Utf8FromUtf16(tmp);
}

}  // namespace

speculum::NodeKind SpeculumNodeSource::kindOf(const void* node) const {
  nsINode* n = AsNode(node);
  if (n->IsElement()) {
    return speculum::NodeKind::Element;
  }
  if (n->IsText()) {
    return speculum::NodeKind::Text;
  }
  if (n->IsComment()) {
    return speculum::NodeKind::Comment;
  }
  if (n->NodeType() == nsINode::DOCUMENT_TYPE_NODE) {
    return speculum::NodeKind::Doctype;
  }
  MOZ_CRASH("SpeculumNodeSource::kindOf: unsupported node");
}

speculum::ElementNs SpeculumNodeSource::nsOf(const void* node) const {
  nsINode* n = AsNode(node);
  nsIContent* content = n->AsContent();
  if (!content || !content->IsElement()) {
    return speculum::ElementNs::None;
  }
  const int32_t nsId = content->GetNameSpaceID();
  if (nsId == kNameSpaceID_XHTML) {
    return speculum::ElementNs::Html;
  }
  if (nsId == kNameSpaceID_SVG) {
    return speculum::ElementNs::Svg;
  }
  if (nsId == kNameSpaceID_MathML) {
    return speculum::ElementNs::Mathml;
  }
  if (nsId == kNameSpaceID_None) {
    return speculum::ElementNs::None;
  }
  return speculum::ElementNs::Custom;
}

std::string SpeculumNodeSource::uriOf(const void* node) const {
  nsINode* n = AsNode(node);
  if (nsOf(node) != speculum::ElementNs::Custom) {
    return std::string();
  }
  nsAutoString uri;
  n->GetNamespaceURI(uri);
  return Utf8FromUtf16(uri);
}

std::string SpeculumNodeSource::nameOf(const void* node) const {
  nsINode* n = AsNode(node);
  if (n->NodeType() == nsINode::DOCUMENT_TYPE_NODE) {
    nsAutoString name;
    static_cast<DocumentType*>(n)->GetName(name);
    return Utf8FromUtf16(name);
  }
  return Utf8FromUtf16(n->LocalName());
}

std::string SpeculumNodeSource::valueOf(const void* node) const {
  nsINode* n = AsNode(node);
  if (!n->IsText() && !n->IsComment()) {
    return std::string();
  }
  nsAutoString data;
  static_cast<CharacterData*>(n)->GetData(data);
  return Utf8FromUtf16(data);
}

std::vector<speculum::AttrPair> SpeculumNodeSource::attrsOf(const void* node) const {
  std::vector<speculum::AttrPair> out;
  Element* el = Element::FromNode(AsNode(node));
  if (!el) {
    return out;
  }
  const AttrArray& attrs = el->GetAttrs();
  const uint32_t count = attrs.AttrCount();
  out.reserve(count);
  for (uint32_t i = 0; i < count; ++i) {
    const nsAttrName* attrName = attrs.AttrNameAt(i);
    const nsAttrValue* attrVal = attrs.AttrAt(i);
    if (!attrName || !attrVal) {
      continue;
    }
    nsAutoString val;
    attrVal->ToString(val);
    out.push_back(speculum::AttrPair{Utf8FromAtom(attrName->LocalName()), Utf8FromUtf16(val)});
  }
  return out;
}

std::vector<const void*> SpeculumNodeSource::childrenOf(const void* node) const {
  std::vector<const void*> out;
  for (nsIContent* child = AsNode(node)->GetFirstChild(); child;
       child = child->GetNextSibling()) {
    if (child->IsElement() || child->IsText() || child->IsComment() ||
        child->NodeType() == nsINode::DOCUMENT_TYPE_NODE) {
      out.push_back(child);
    }
  }
  return out;
}

bool SpeculumNodeSource::isUaOwned(const void* node) const {
  return AsNode(node)->IsInNativeAnonymousSubtree();
}

namespace {

uint32_t NextSpeculumFrameIndex() {
  static uint32_t sNext = 0;
  return sNext++;
}

std::string Base64Encode(const uint8_t* aData, size_t aLen) {
  static const char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((aLen + 2) / 3) * 4);
  for (size_t i = 0; i < aLen; i += 3) {
    const uint32_t b0 = aData[i];
    const uint32_t b1 = (i + 1 < aLen) ? aData[i + 1] : 0;
    const uint32_t b2 = (i + 2 < aLen) ? aData[i + 2] : 0;
    const uint32_t n = (b0 << 16) | (b1 << 8) | b2;
    out.push_back(kAlphabet[(n >> 18) & 0x3f]);
    out.push_back(kAlphabet[(n >> 12) & 0x3f]);
    out.push_back((i + 1 < aLen) ? kAlphabet[(n >> 6) & 0x3f] : '=');
    out.push_back((i + 2 < aLen) ? kAlphabet[n & 0x3f] : '=');
  }
  return out;
}

void EmitFrameToStderr(uint32_t aSeq, const std::vector<uint8_t>& aFrame) {
  // stderr write is only atomic up to ~4 KiB; keep each line under 3000 bytes.
  constexpr size_t kMaxB64PerPart = 2048;
  const std::string b64 = Base64Encode(aFrame.data(), aFrame.size());
  if (b64.empty()) {
    return;
  }
  const uint32_t partCount = static_cast<uint32_t>(
      (b64.size() + kMaxB64PerPart - 1) / kMaxB64PerPart);
  for (uint32_t idx = 0; idx < partCount; ++idx) {
    const size_t start = static_cast<size_t>(idx) * kMaxB64PerPart;
    const size_t chunkLen = std::min(kMaxB64PerPart, b64.size() - start);
    const std::string part = b64.substr(start, chunkLen);
    printf_stderr("[SPECULUM-FRAME-PART] seq=%u idx=%u de=%u %s\n", aSeq, idx,
                  partCount, part.c_str());
  }
}

bool IsSpeculumChromeOrNonContent(mozilla::dom::Document* aDocument) {
  if (!aDocument || aDocument->IsInChromeDocShell()) {
    return true;
  }
  nsIDocShell* shell = aDocument->GetDocShell();
  if (!shell) {
    return true;
  }
  BrowsingContext* bc = shell->GetBrowsingContext();
  if (!bc) {
    return true;
  }
  return !bc->IsContent();
}

bool WriteBootstrapFrame(mozilla::dom::Document* aDocument) {
  if (IsSpeculumChromeOrNonContent(aDocument) ||
      !aDocument->IsContentDocument()) {
    return false;
  }
  SpeculumNodeSource source;
  speculum::Producer producer(source);
  producer.bootstrap(aDocument);
  const uint32_t ops = producer.pendingOps();
  std::vector<uint8_t> frame = producer.emitFrame();
  if (frame.empty()) {
    return false;
  }
  nsAutoCString uri("(null)");
  if (nsIURI* docUri = aDocument->GetDocumentURI()) {
    uri = docUri->GetSpecOrDefault();
  }
  printf_stderr("[SPECULUM-BOOT] pid=%d uri=%s ops=%u bytes=%zu\n",
                static_cast<int>(getpid()), uri.get(), ops, frame.size());
  mkdir("/tmp/speculum-frames", 0777);
  const uint32_t index = NextSpeculumFrameIndex();
  char binPath[128];
  (void)snprintf(binPath, sizeof(binPath), "/tmp/speculum-frames/frame_%u.bin",
                 index);
  if (FILE* fp = fopen(binPath, "wb")) {
    (void)fwrite(frame.data(), 1, frame.size(), fp);
    fclose(fp);
  }
  if (FILE* fp = fopen("/tmp/speculum-frames/frames.txt", "a")) {
    char line[64];
    const int lineLen =
        snprintf(line, sizeof(line), "frame_%u.bin\n", index);
    if (lineLen > 0) {
      (void)fwrite(line, 1, static_cast<size_t>(lineLen), fp);
    }
    fclose(fp);
  }
  const uint32_t seq = producer.sequence();
  EmitFrameToStderr(seq, frame);
  printf_stderr(
      "[SPECULUM] bootstrap frame_%u bytes=%zu tableHash=%llu\n", index,
      frame.size(),
      static_cast<unsigned long long>(producer.table().tableHash()));
  return true;
}

}  // namespace

void SpeculumTryWriteBootstrapFrame(mozilla::dom::Document* aDocument) {
  if (!aDocument || IsSpeculumChromeOrNonContent(aDocument)) {
    return;
  }
  static mozilla::dom::Document* sLastBootstrappedDocument = nullptr;
  if (sLastBootstrappedDocument == aDocument) {
    return;
  }
  if (WriteBootstrapFrame(aDocument)) {
    sLastBootstrappedDocument = aDocument;
  }
}
