#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
text = p.read_text()

if "#include <unistd.h>" not in text:
    text = text.replace("#include <cstdio>\n", "#include <cstdio>\n#include <unistd.h>\n", 1)

# Disable bootstrap hook for diagnostic run.
hook = """  if (aReadyState == READYSTATE_COMPLETE && mSpeculumWatchingDOMMutations) {
    SpeculumTryWriteBootstrapFrame(this);
  }
"""
if hook in text:
    text = text.replace(hook, "", 1)

diag_fn = """void Document::SetSpeculumWatchingDOMMutations(bool aValue) {
  // Diagnostic-only path (speculum-doc-diagnostic.py).
  if (mSpeculumWatchingDOMMutations == aValue || mIsGoingAway) {
    return;
  }
  if (aValue) {
    nsAutoCString uri("(null)");
    if (nsIURI* docUri = GetDocumentURI()) {
      uri = docUri->GetSpecOrDefault();
    }
    int bcIsContent = -1;
    if (nsIDocShell* shell = GetDocShell()) {
      if (BrowsingContext* bc = shell->GetBrowsingContext()) {
        bcIsContent = bc->IsContent() ? 1 : 0;
      }
    }
    const bool hasParentDoc = GetEmbedderElement() != nullptr;
    const char* proc = XRE_IsParentProcess() ? "pai" : "conteudo";
    printf_stderr(
        "[SPECULUM-DOC] pid=%d | proc=%s | uri=%s | contentDoc=%d | "
        "chromeShell=%d | bcIsContent=%d | systemPrincipal=%d | hasParentDoc=%d "
        "| root=%d\\n",
        getpid(), proc, uri.get(), IsContentDocument() ? 1 : 0,
        IsInChromeDocShell() ? 1 : 0, bcIsContent,
        NodePrincipal()->IsSystemPrincipal() ? 1 : 0, hasParentDoc ? 1 : 0,
        hasParentDoc ? 0 : 1);
    return;
  }
  mSpeculumWatchingDOMMutations = aValue;
  SpeculumDetachMutationObserverFromDocument(this);
}
"""

start = text.find("void Document::SetSpeculumWatchingDOMMutations(bool aValue) {")
if start == -1:
    raise SystemExit("SetSpeculumWatchingDOMMutations not found")
end = text.find("\n\n\nvoid EvaluateMediaQueryLists", start)
if end == -1:
    raise SystemExit("end marker not found")
text = text[:start] + diag_fn + text[end:]
p.write_text(text)
print("diagnostic SetSpeculumWatching installed")
