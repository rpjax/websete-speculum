/* Speculum — NodeSource sobre nsINode (produtor PageProjection). */
#include "mozilla/Assertions.h"
#define SPECULUM_FATAL(msg) MOZ_CRASH(msg)
#include "SpeculumNodeSource.h"

#include "AttrArray.h"
#include "DocumentType.h"
#include "Element.h"
#include "NameSpaceConstants.h"
#include "mozilla/dom/CharacterData.h"
#include "SpeculumCssom.h"
#include "SpeculumMutationObserver.h"
#include "nsAttrName.h"
#include "nsAttrValue.h"
#include "nsIContent.h"
#include "nsINode.h"
#include "nsTArray.h"
#include "nsReadableUtils.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/CSSRuleList.h"
#include "mozilla/dom/HTMLInputElement.h"
#include "mozilla/dom/HTMLOptionElement.h"
#include "mozilla/dom/HTMLTextAreaElement.h"
#include "mozilla/dom/ShadowRoot.h"
#include "mozilla/css/Rule.h"
#include "mozilla/StyleSheet.h"
#include "mozilla/ServoCSSRuleList.h"
#include "nsCOMPtr.h"
#include "nsFrameLoaderOwner.h"
#include "nsGkAtoms.h"
#include "nsIDocShell.h"
#include "nsIPrincipal.h"
#include "nsString.h"

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
  if (n->IsShadowRoot()) {
    return speculum::NodeKind::ShadowRoot;
  }
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
  if (IsCssom(node)) {
    return speculum::ElementNs::None;
  }
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
  if (IsCssom(node)) {
    return std::string();
  }
  nsINode* n = AsNode(node);
  if (nsOf(node) != speculum::ElementNs::Custom) {
    return std::string();
  }
  nsAutoString uri;
  n->GetNamespaceURI(uri);
  return Utf8FromUtf16(uri);
}

std::string SpeculumNodeSource::nameOf(const void* node) const {
  if (IsCssom(node)) {
    return std::string();
  }
  nsINode* n = AsNode(node);
  if (n->NodeType() == nsINode::DOCUMENT_TYPE_NODE) {
    nsAutoString name;
    static_cast<DocumentType*>(n)->GetName(name);
    return Utf8FromUtf16(name);
  }
  return Utf8FromUtf16(n->LocalName());
}

std::string SpeculumNodeSource::valueOf(const void* node) const {
  if (IsCssom(node)) {
    return std::string();
  }
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
  if (IsCssom(node)) {
    return out;
  }
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
  if (IsCssom(node)) {
    return out;
  }
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
  if (IsCssom(node)) {
    return false;
  }
  nsINode* n = AsNode(node);
  if (n->IsInNativeAnonymousSubtree()) {
    return true;
  }
  // shadow.md NIT: UA / SVG <use> impl shadows must not ride the author ShadowRoot wire.
  // Gecko builds <use> via AttachShadowWithoutNameChecks (closed) without SetIsUAWidget —
  // Chrome cannot attachShadow on svg:use; the consumer browser recreates the use tree.
  if (auto* sr = mozilla::dom::ShadowRoot::FromNode(n)) {
    if (sr->IsUAWidget()) {
      return true;
    }
    if (Element* host = sr->GetHost()) {
      if (host->IsSVGElement(nsGkAtoms::use)) {
        return true;
      }
    }
  }
  return false;
}

bool SpeculumNodeSource::isNestedHost(const void* node) const {
  if (IsCssom(node)) {
    return false;
  }
  Element* el = Element::FromNode(AsNode(node));
  if (!el || !el->IsInComposedDoc()) {
    return false;
  }
  nsCOMPtr<nsFrameLoaderOwner> owner = do_QueryInterface(el);
  return owner != nullptr;
}

uint32_t SpeculumNodeSource::childScopeIdOf(const void* node) const {
  if (IsCssom(node)) {
    return 0;
  }
  Element* el = Element::FromNode(AsNode(node));
  if (!el) {
    return 0;
  }
  nsCOMPtr<nsFrameLoaderOwner> owner = do_QueryInterface(el);
  if (!owner) {
    return 0;
  }
  mozilla::dom::BrowsingContext* bc = owner->GetBrowsingContext();
  if (!bc) {
    return 0;
  }
  const uint32_t c = bc->GetSpeculumContextId();
  if (c == 1) {
    MOZ_CRASH("Speculum: iframe BrowsingContext stamped as root contextId");
  }
  return c >= 2 ? c : 0;
}

bool SpeculumNodeSource::isConnected(const void* node) const {
  return AsNode(node)->IsInComposedDoc();
}

const void* SpeculumNodeSource::shadowRootOf(const void* host) const {
  if (IsCssom(host)) {
    return nullptr;
  }
  Element* el = Element::FromNode(AsNode(host));
  if (!el) {
    return nullptr;
  }
  mozilla::dom::ShadowRoot* sr = el->GetShadowRoot();
  if (!sr || isUaOwned(sr)) {
    return nullptr;
  }
  return sr;
}

const void* SpeculumNodeSource::shadowHostOf(const void* shadowRoot) const {
  if (IsCssom(shadowRoot)) {
    return nullptr;
  }
  mozilla::dom::ShadowRoot* sr =
      mozilla::dom::ShadowRoot::FromNode(AsNode(shadowRoot));
  return sr ? sr->GetHost() : nullptr;
}

uint8_t SpeculumNodeSource::shadowModeOf(const void* shadowRoot) const {
  if (IsCssom(shadowRoot)) {
    return 0;
  }
  mozilla::dom::ShadowRoot* sr =
      mozilla::dom::ShadowRoot::FromNode(AsNode(shadowRoot));
  if (!sr) {
    return 0;
  }
  return sr->IsClosed() ? 1 : 0;
}

std::vector<speculum::FormProp> SpeculumNodeSource::formPropsOf(
    const void* node) const {
  std::vector<speculum::FormProp> out;
  if (IsCssom(node)) {
    return out;
  }
  nsINode* n = AsNode(node);
  if (auto* input = mozilla::dom::HTMLInputElement::FromNode(n)) {
    nsAutoString type;
    input->GetType(type);
    if (type.LowerCaseEqualsLiteral("checkbox") ||
        type.LowerCaseEqualsLiteral("radio")) {
      out.push_back(speculum::FormProp{
          0x02, speculum::PropValue::boolean(input->Checked())});
    } else if (!type.LowerCaseEqualsLiteral("file") &&
               !type.LowerCaseEqualsLiteral("button") &&
               !type.LowerCaseEqualsLiteral("submit") &&
               !type.LowerCaseEqualsLiteral("reset") &&
               !type.LowerCaseEqualsLiteral("image")) {
      nsAutoString value;
      input->GetValue(value, mozilla::dom::CallerType::System);
      out.push_back(speculum::FormProp{
          0x01, speculum::PropValue::str(Utf8FromUtf16(value))});
    }
    return out;
  }
  if (auto* area = mozilla::dom::HTMLTextAreaElement::FromNode(n)) {
    nsAutoString value;
    area->GetValue(value);
    out.push_back(speculum::FormProp{
        0x01, speculum::PropValue::str(Utf8FromUtf16(value))});
    return out;
  }
  if (auto* option = mozilla::dom::HTMLOptionElement::FromNode(n)) {
    out.push_back(speculum::FormProp{
        0x03, speculum::PropValue::boolean(option->Selected())});
  }
  return out;
}

void SpeculumNodeSource::BindDocument(mozilla::dom::Document* aDocument) {
  mDocument = aDocument;
}

void SpeculumNodeSource::CaptureLiveCssom() {
  mSheets.clear();
  mRules.clear();
  mRuleText.clear();
  mRuleSheet.clear();
  if (!mDocument) {
    return;
  }

  auto noteSheet = [this](mozilla::StyleSheet& aSheet) {
    // C6: `<style>` ownerNode → DOM only (no double-emit into adopted).
    if (!SpeculumIsCssomPlaneSheet(&aSheet)) {
      return;
    }
    NoteSheet(&aSheet);
    // Motor lendo o CSSOM próprio — não o cssRules do JS da página.
    // GetCssRules(principal) recusa sheet incompleto e CORS; o bootstrap
    // então emitia SHEET vazio e o resync ainda descartava o ponteiro.
    mozilla::ServoCSSRuleList* list = aSheet.GetCssRulesInternal();
    if (!list) {
      return;
    }
    const uint32_t n = list->Length();
    for (uint32_t i = 0; i < n; ++i) {
      mozilla::css::Rule* rule = list->Item(i);
      if (!rule) {
        continue;
      }
      nsAutoCString text;
      rule->GetCssText(text);
      NoteRule(&aSheet, rule, std::string(text.get()));
    }
  };

  auto walkRoot = [&](auto* root) {
    if (!root) {
      return;
    }
    const size_t n = root->SheetCount();
    for (size_t i = 0; i < n; ++i) {
      if (mozilla::StyleSheet* sheet = root->SheetAt(i)) {
        noteSheet(*sheet);
      }
    }
    for (mozilla::StyleSheet* sheet : root->AdoptedStyleSheets()) {
      if (sheet) {
        noteSheet(*sheet);
      }
    }
  };

  walkRoot(mDocument);

  auto walkComposed = [&](auto&& self, nsINode* node) -> void {
    if (!node) {
      return;
    }
    if (node->IsElement()) {
      if (mozilla::dom::ShadowRoot* sr = node->AsElement()->GetShadowRoot()) {
        if (!isUaOwned(sr)) {
          walkRoot(sr);
          for (nsIContent* child = sr->GetFirstChild(); child;
               child = child->GetNextSibling()) {
            self(self, child);
          }
        }
      }
    }
    for (nsIContent* child = node->GetFirstChild(); child;
         child = child->GetNextSibling()) {
      self(self, child);
    }
  };
  walkComposed(walkComposed, mDocument);
}

bool SpeculumNodeSource::isSheet(const void* aPtr) const {
  if (!aPtr) {
    return false;
  }
  for (const void* s : mSheets) {
    if (s == aPtr) {
      return true;
    }
  }
  return false;
}

bool SpeculumNodeSource::isRule(const void* aPtr) const {
  return aPtr && mRuleSheet.find(aPtr) != mRuleSheet.end();
}

void SpeculumNodeSource::NoteSheet(const void* aSheet) {
  if (!aSheet) {
    return;
  }
  for (const void* s : mSheets) {
    if (s == aSheet) {
      return;
    }
  }
  mSheets.push_back(aSheet);
}

void SpeculumNodeSource::DropSheet(const void* aSheet) {
  std::vector<const void*> kept;
  for (const void* s : mSheets) {
    if (s != aSheet) {
      kept.push_back(s);
    }
  }
  mSheets.swap(kept);
  auto it = mRules.find(aSheet);
  if (it != mRules.end()) {
    for (const void* r : it->second) {
      mRuleText.erase(r);
      mRuleSheet.erase(r);
    }
    mRules.erase(it);
  }
}

void SpeculumNodeSource::NoteRule(const void* aSheet, const void* aRule,
                                  const std::string& aText) {
  if (!aRule) {
    return;
  }
  // Projected applies on Chromium. Firefox-only selectors/at-rules fail
  // CSSStyleSheet.insertRule there and abort the whole resync frame.
  // Nested under @media/@supports Chromium still parses the wrapper; skip only
  // top-level offenders. Paint for these rules stays Virtual-only (NIT gap).
  {
    size_t i = 0;
    while (i < aText.size() &&
           (aText[i] == ' ' || aText[i] == '\n' || aText[i] == '\r' ||
            aText[i] == '\t')) {
      ++i;
    }
    const bool topLevelAt = i < aText.size() && aText[i] == '@';
    if ((!topLevelAt && (aText.find("::-moz-") != std::string::npos ||
                         aText.find(":-moz-") != std::string::npos)) ||
        (i + 6 <= aText.size() && aText.compare(i, 6, "@-moz-") == 0)) {
      return;
    }
  }
  mRuleSheet[aRule] = aSheet;
  mRuleText[aRule] = aText;
  auto& list = mRules[aSheet];
  for (const void* r : list) {
    if (r == aRule) {
      return;
    }
  }
  list.push_back(aRule);
}

void SpeculumNodeSource::DropRule(const void* aRule) {
  auto sheetIt = mRuleSheet.find(aRule);
  if (sheetIt != mRuleSheet.end()) {
    auto& list = mRules[sheetIt->second];
    std::vector<const void*> kept;
    for (const void* r : list) {
      if (r != aRule) {
        kept.push_back(r);
      }
    }
    list.swap(kept);
    mRuleSheet.erase(sheetIt);
  }
  mRuleText.erase(aRule);
}

void SpeculumNodeSource::SetRuleText(const void* aRule, const std::string& aText) {
  mRuleText[aRule] = aText;
}

std::vector<const void*> SpeculumNodeSource::cssomSheets() const {
  return mSheets;
}

std::vector<const void*> SpeculumNodeSource::cssomRulesOf(
    const void* sheet) const {
  auto it = mRules.find(sheet);
  return it == mRules.end() ? std::vector<const void*>{} : it->second;
}

std::string SpeculumNodeSource::cssomRuleTextOf(const void* rule) const {
  auto it = mRuleText.find(rule);
  return it == mRuleText.end() ? std::string() : it->second;
}

const void* SpeculumNodeSource::cssomSheetOf(const void* rule) const {
  auto it = mRuleSheet.find(rule);
  return it == mRuleSheet.end() ? nullptr : it->second;
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
  // A marca é do documento. Um estático guardando o último ponteiro engole o
  // bootstrap do documento seguinte quando o alocador recicla o endereço — e
  // o documento seguinte é exatamente a página para onde se navegou.
  if (aDocument->SpeculumBootstrapped()) {
    return;
  }
  if (WriteBootstrapFrame(aDocument)) {
    aDocument->SetSpeculumBootstrapped(true);
  }
}
