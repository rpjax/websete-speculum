/* Speculum — NodeSource sobre nsINode (produtor PageProjection). */
#include "mozilla/Assertions.h"
#define SPECULUM_FATAL(msg) MOZ_CRASH(msg)
#include "SpeculumNodeSource.h"

#include "AttrArray.h"
#include "DocumentType.h"
#include "Element.h"
#include "NameSpaceConstants.h"
#include "mozilla/dom/CharacterData.h"
#include "SpeculumMutationObserver.h"
#include "nsAttrName.h"
#include "nsAttrValue.h"
#include "nsIContent.h"
#include "nsINode.h"
#include "nsTArray.h"
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

SpeculumNodeSource::SpeculumNodeSource() {
  static uint64_t sNextDocToken = 1;
  mDocToken = sNextDocToken++;
}

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
  SpeculumMutationObserver* obs = aDocument->GetSpeculumMutationObserver();
  if (!obs) {
    return false;
  }
  return obs->TryWriteBootstrapFrame();
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
