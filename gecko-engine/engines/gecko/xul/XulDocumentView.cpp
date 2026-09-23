/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

#include "engines/gecko/xul/XulDocumentView.hpp"

#if defined(SPECULUM_HAS_LIBXUL)

#include "mozilla/ErrorResult.h"
#include "mozilla/dom/Element.h"
#include "mozilla/dom/ShadowRoot.h"
#include "nsAtom.h"
#include "nsIContent.h"
#include "nsINode.h"
#include "nsNameSpaceManager.h"

namespace speculum::gecko::xul {

NodeKind XulDocumentView::kind(NodeRef r) const {
  nsINode* n = raw(r);
  if (!n) return NodeKind::Element;
  uint16_t t = n->NodeType();
  if (t == nsINode::DOCUMENT_NODE) return NodeKind::Document;
  if (t == nsINode::TEXT_NODE || t == nsINode::CDATA_SECTION_NODE)
    return NodeKind::Text;
  if (t == nsINode::COMMENT_NODE) return NodeKind::Comment;
  // Doctype has no distinct NodeKind in the redesign ports — treat as Comment.
  if (t == nsINode::DOCUMENT_TYPE_NODE) return NodeKind::Comment;
  return NodeKind::Element;
}

ElementNs XulDocumentView::ns(NodeRef r) const {
  nsINode* n = raw(r);
  if (!n || !n->IsElement()) return ElementNs::Html;
  int32_t id = n->AsElement()->GetNameSpaceID();
  if (id == kNameSpaceID_SVG) return ElementNs::Svg;
  if (id == kNameSpaceID_MathML) return ElementNs::MathMl;
  return ElementNs::Html;
}

std::string_view XulDocumentView::localName(NodeRef r) const {
  nsINode* n = raw(r);
  if (!n) return {};
  if (n->IsElement()) {
    nsAtom* atom = n->AsElement()->NodeInfo()->NameAtom();
    nsAutoCString c;
    atom->ToUTF8String(c);
    scratchName_.assign(c.get(), c.Length());
    return scratchName_;
  }
  return {};
}

std::string_view XulDocumentView::characterData(NodeRef r) const {
  nsINode* n = raw(r);
  if (!n || !n->IsText()) return {};
  nsAutoString data;
  static_cast<nsIContent*>(n)->GetTextContent(data, mozilla::IgnoreErrors());
  NS_ConvertUTF16toUTF8 utf8(data);
  scratchValue_.assign(utf8.get(), utf8.Length());
  return scratchValue_;
}

uint32_t XulDocumentView::childCount(NodeRef r) const {
  nsINode* n = raw(r);
  return n ? n->GetChildCount() : 0;
}

NodeRef XulDocumentView::childAt(NodeRef r, uint32_t i) const {
  nsINode* n = raw(r);
  if (!n) return {};
  nsIContent* c = n->GetChildAt_Deprecated(i);
  return c ? nodes_.lookup(static_cast<void*>(c)) : NodeRef{};
}

NodeRef XulDocumentView::parent(NodeRef r) const {
  nsINode* n = raw(r);
  if (!n) return {};
  nsINode* p = n->GetParentNode();
  return p ? nodes_.lookup(static_cast<void*>(p)) : NodeRef{};
}

NodeRef XulDocumentView::shadowRoot(NodeRef host) const {
  nsINode* n = raw(host);
  if (!n || !n->IsElement()) return {};
  auto* sr = n->AsElement()->GetShadowRoot();
  return sr ? nodes_.lookup(static_cast<void*>(sr)) : NodeRef{};
}

NodeRef XulDocumentView::shadowHost(NodeRef) const { return {}; }

uint32_t XulDocumentView::attrCount(NodeRef r) const {
  nsINode* n = raw(r);
  if (!n || !n->IsElement()) return 0;
  return n->AsElement()->GetAttrCount();
}

void XulDocumentView::attrAt(NodeRef r, uint32_t i, std::string_view& name,
                             std::string_view& value) const {
  name = {};
  value = {};
  nsINode* n = raw(r);
  if (!n || !n->IsElement()) return;
  auto* el = n->AsElement();
  if (i >= el->GetAttrCount()) return;
  const nsAttrName* an = el->GetAttrNameAt(i);
  if (!an) return;
  nsAutoString nsName;
  an->LocalName()->ToString(nsName);
  nsAutoString nsVal;
  el->GetAttr(an->NamespaceID(), an->LocalName(), nsVal);
  NS_ConvertUTF16toUTF8 n8(nsName);
  NS_ConvertUTF16toUTF8 v8(nsVal);
  scratchName_.assign(n8.get(), n8.Length());
  scratchValue_.assign(v8.get(), v8.Length());
  name = scratchName_;
  value = scratchValue_;
}

bool XulDocumentView::attr(NodeRef r, std::string_view name,
                           std::string_view& value) const {
  value = {};
  nsINode* n = raw(r);
  if (!n || !n->IsElement()) return false;
  RefPtr<nsAtom> atom = NS_Atomize(
      nsDependentCSubstring(name.data(), name.size()));
  if (!atom) return false;
  nsAutoString nsVal;
  if (!n->AsElement()->GetAttr(atom, nsVal)) return false;
  NS_ConvertUTF16toUTF8 v8(nsVal);
  scratchValue_.assign(v8.get(), v8.Length());
  value = scratchValue_;
  return true;
}

uint32_t XulDocumentView::sheetCount() const {
  return cssom_ ? uint32_t(cssom_->sheetCount()) : 0;
}

SheetRef XulDocumentView::sheetAt(uint32_t i) const {
  return cssom_ ? cssom_->sheetAt(i) : SheetRef{};
}

bool XulDocumentView::sheetDisabled(SheetRef) const { return false; }
std::string_view XulDocumentView::sheetMedia(SheetRef) const { return {}; }

NodeRef XulDocumentView::sheetOwner(SheetRef s) const {
  if (!cssom_) return {};
  auto sh = cssom_->sheet(s);
  return sh ? sh->owner : NodeRef{};
}

uint32_t XulDocumentView::ruleCount(SheetRef s) const {
  if (!cssom_) return 0;
  auto sh = cssom_->sheet(s);
  return sh ? uint32_t(sh->rules.size()) : 0;
}

RuleRef XulDocumentView::ruleAt(SheetRef s, uint32_t i) const {
  if (!cssom_) return {};
  auto sh = cssom_->sheet(s);
  if (!sh || i >= sh->rules.size()) return {};
  return sh->rules[i];
}

RuleRef XulDocumentView::parentRule(RuleRef) const { return {}; }
std::string_view XulDocumentView::ruleType(RuleRef) const { return {}; }
std::string_view XulDocumentView::ruleCondition(RuleRef) const { return {}; }

std::string_view XulDocumentView::ruleSelector(RuleRef r) const {
  if (!cssom_) return {};
  auto rd = cssom_->rule(r);
  if (!rd) return {};
  scratchValue_ = rd->selector;
  return scratchValue_;
}

uint32_t XulDocumentView::declarationCount(RuleRef) const { return 0; }

void XulDocumentView::declarationAt(RuleRef, uint32_t, std::string_view& name,
                                    AtomRef& value, bool& important) const {
  name = {};
  value = {};
  important = false;
}

}  // namespace speculum::gecko::xul

#endif
