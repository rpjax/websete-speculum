/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */

#include "engines/gecko/xul/XulMutationObserver.hpp"

#include <unordered_map>
#include <vector>

#include "mozilla/ErrorResult.h"
#include "mozilla/RefPtr.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/Element.h"
#include "mozilla/dom/ShadowRoot.h"
#include "nsAtom.h"
#include "nsIContent.h"
#include "nsINode.h"

#include "domain/Types.hpp"

namespace speculum::gecko::xul {

NS_IMPL_ISUPPORTS(XulMutationObserver, nsIMutationObserver)

XulMutationObserver::XulMutationObserver(mozilla::dom::Document* doc,
                                         RawNodeMap& nodes,
                                         MutationBridge& bridge)
    : doc_(doc), nodes_(nodes), bridge_(bridge) {}

XulMutationObserver::~XulMutationObserver() = default;

NodeRef XulMutationObserver::ensure(nsINode* n) {
  if (!n) return {};
  return nodes_.intern(static_cast<void*>(n));
}

void XulMutationObserver::AttachToDocument() {
  if (!doc_) return;
  doc_->AddMutationObserver(this);
  // Seed document + documentElement if present.
  ensure(doc_);
  if (auto* root = doc_->GetDocumentElement()) {
    ensure(root);
  }
}

void XulMutationObserver::DetachFromDocument() {
  if (doc_) {
    doc_->RemoveMutationObserver(this);
    doc_ = nullptr;
  }
  // Explicit unbind: drop every handle. Live forget stays on NodeWillBeDestroyed.
  nodes_.clear();
}

void XulMutationObserver::ObserveShadowRecursive(mozilla::dom::ShadowRoot* shadow) {
  if (!shadow) return;
  shadow->AddMutationObserver(this);
  ensure(shadow);
  for (nsIContent* c = shadow->GetFirstChild(); c; c = c->GetNextSibling()) {
    maybeObserveShadow(c);
  }
}

void XulMutationObserver::maybeObserveShadow(nsIContent* child) {
  if (!child || !child->IsElement()) return;
  auto* el = child->AsElement();
  auto* sr = el->GetShadowRoot();
  if (sr) {
    NodeRef host = ensure(el);
    NodeRef root = ensure(sr);
    bridge_.notifyShadow(host, ShadowMode::Open, root);
    ObserveShadowRecursive(sr);
  }
}

void XulMutationObserver::CharacterDataChanged(nsIContent* content,
                                               const CharacterDataChangeInfo&) {
  if (!content) return;
  NodeRef r = ensure(content);
  nsAutoString data;
  content->GetTextContent(data, mozilla::IgnoreErrors());
  NS_ConvertUTF16toUTF8 utf8(data);
  bridge_.notifyText(r, std::string_view(utf8.get(), utf8.Length()));
}

void XulMutationObserver::AttributeChanged(mozilla::dom::Element* element,
                                           int32_t, nsAtom* attribute,
                                           AttrModType, const nsAttrValue*) {
  if (!element || !attribute) return;
  NodeRef r = ensure(element);
  nsAutoString name;
  attribute->ToString(name);
  nsAutoString value;
  element->GetAttr(attribute, value);
  NS_ConvertUTF16toUTF8 n8(name);
  NS_ConvertUTF16toUTF8 v8(value);
  bridge_.notifyAttr(r, std::string_view(n8.get(), n8.Length()),
                     std::string_view(v8.get(), v8.Length()));
}

void XulMutationObserver::ContentAppended(nsIContent* firstNewContent,
                                          const ContentAppendInfo&) {
  if (!firstNewContent) return;
  nsINode* parent = firstNewContent->GetParentNode();
  if (!parent) return;
  NodeRef p = ensure(parent);
  // Collect contiguous siblings from firstNewContent.
  std::vector<NodeRef> added;
  for (nsIContent* c = firstNewContent; c; c = c->GetNextSibling()) {
    added.push_back(ensure(c));
    maybeObserveShadow(c);
  }
  uint32_t index = 0;
  for (nsIContent* c = parent->GetFirstChild(); c && c != firstNewContent;
       c = c->GetNextSibling()) {
    ++index;
  }
  bridge_.notifyChildList(p, index, 0, added.data(), uint32_t(added.size()));
}

void XulMutationObserver::ContentInserted(nsIContent* child,
                                          const ContentInsertInfo&) {
  if (!child) return;
  nsINode* parent = child->GetParentNode();
  if (!parent) return;
  NodeRef p = ensure(parent);
  NodeRef c = ensure(child);
  uint32_t index = 0;
  for (nsIContent* s = parent->GetFirstChild(); s && s != child;
       s = s->GetNextSibling()) {
    ++index;
  }
  bridge_.notifyChildList(p, index, 0, &c, 1);
  maybeObserveShadow(child);
}

void XulMutationObserver::ContentWillBeRemoved(nsIContent* child,
                                               const ContentRemoveInfo&) {
  if (!child) return;
  nsINode* parent = child->GetParentNode();
  if (!parent) return;
  NodeRef p = ensure(parent);
  uint32_t index = 0;
  for (nsIContent* s = parent->GetFirstChild(); s && s != child;
       s = s->GetNextSibling()) {
    ++index;
  }
  bridge_.notifyChildList(p, index, 1, nullptr, 0);
}

void XulMutationObserver::NodeWillBeDestroyed(nsINode* node) {
  if (!node) return;
  if (node == doc_) {
    doc_ = nullptr;
  }
  nodes_.forgetRaw(static_cast<void*>(node));
}

// --- process-wide attach table (weak docs; observers held by Document) ---

struct AttachEntry {
  RefPtr<XulMutationObserver> obs;
};

// Document* → observer (Document holds AddMutationObserver ref; we keep one too
// only for Detach). Not a cycle Document→adapter→Document: we store Document*
// weak inside observer and clear on destroy.
static std::unordered_map<mozilla::dom::Document*, AttachEntry>& attachMap() {
  static std::unordered_map<mozilla::dom::Document*, AttachEntry> m;
  return m;
}

void AttachObserver(mozilla::dom::Document* doc, RawNodeMap& nodes,
                    MutationBridge& bridge) {
  if (!doc) return;
  auto& m = attachMap();
  if (m.count(doc)) return;
  RefPtr<XulMutationObserver> obs = new XulMutationObserver(doc, nodes, bridge);
  obs->AttachToDocument();
  m[doc] = AttachEntry{obs};
}

void DetachObserver(mozilla::dom::Document* doc) {
  if (!doc) return;
  auto& m = attachMap();
  auto it = m.find(doc);
  if (it == m.end()) return;
  // Drop the process-table RefPtr only. Document still owns the observer via
  // AddMutationObserver until teardown — required for A1 forget-on-destroy.
  it->second.obs->DetachFromDocument();
  m.erase(it);
}

bool xulGlueLinked() { return true; }

}  // namespace speculum::gecko::xul
