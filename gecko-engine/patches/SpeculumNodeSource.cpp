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
#include "nsThreadUtils.h"

#include "mozilla/dom/Document.h"

#include <cstdio>
#include <sys/stat.h>
#include <sys/types.h>
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

void WriteBootstrapFrame(mozilla::dom::Document* aDocument) {
  SpeculumNodeSource source;
  speculum::Producer producer(source);
  producer.bootstrap(aDocument);
  std::vector<uint8_t> frame = producer.emitFrame();
  if (frame.empty()) {
    return;
  }
  mkdir("/tmp/speculum-frames", 0777);
  if (FILE* fp = fopen("/tmp/speculum-frames/frame_0.bin", "wb")) {
    (void)fwrite(frame.data(), 1, frame.size(), fp);
    fclose(fp);
  }
  if (FILE* fp = fopen("/tmp/speculum-frames/frames.txt", "w")) {
    (void)fwrite("frame_0.bin\n", 1, 12, fp);
    fclose(fp);
  }
  printf_stderr("[SPECULUM] bootstrap frame bytes=%zu tableHash=%llu\n",
                frame.size(),
                static_cast<unsigned long long>(producer.table().tableHash()));
}

class SpeculumBootstrapRunnable final : public Runnable {
 public:
  explicit SpeculumBootstrapRunnable(already_AddRefed<mozilla::dom::Document> aDoc)
      : Runnable("SpeculumBootstrapRunnable"),
        mDocument(std::move(aDoc)) {}

  NS_IMETHOD Run() override {
    if (!mDocument || !mDocument->GetComposedDoc()) {
      return NS_OK;
    }
    if (mDocument->GetReadyStateEnum() !=
        mozilla::dom::Document::READYSTATE_COMPLETE) {
      nsCOMPtr<nsIRunnable> again =
          new SpeculumBootstrapRunnable(do_AddRef(mDocument));
      NS_DispatchToCurrentThread(again.forget());
      return NS_OK;
    }
    WriteBootstrapFrame(mDocument);
    return NS_OK;
  }

 private:
  RefPtr<mozilla::dom::Document> mDocument;
};

}  // namespace

void SpeculumScheduleBootstrapFrame(mozilla::dom::Document* aDocument) {
  if (!aDocument) {
    return;
  }
  nsCOMPtr<nsIRunnable> task = new SpeculumBootstrapRunnable(do_AddRef(aDocument));
  NS_DispatchToCurrentThread(task.forget());
}
