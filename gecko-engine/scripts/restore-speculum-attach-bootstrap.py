#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
text = p.read_text()

fn = """void Document::SetSpeculumWatchingDOMMutations(bool aValue) {
  if (mSpeculumWatchingDOMMutations == aValue || mIsGoingAway) {
    return;
  }
  mSpeculumWatchingDOMMutations = aValue;
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
    mkdir("/tmp/speculum-docs", 0777);
    char logPath[128];
    const pid_t pid = getpid();
    snprintf(logPath, sizeof(logPath), "/tmp/speculum-docs/%d.log",
             static_cast<int>(pid));
    if (FILE* fp = fopen(logPath, "a")) {
      fprintf(
          fp,
          "[SPECULUM-DOC] pid=%d | proc=%s | uri=%s | contentDoc=%d | "
          "chromeShell=%d | bcIsContent=%d | systemPrincipal=%d | hasParentDoc=%d "
          "| root=%d\\n",
          static_cast<int>(pid), proc, uri.get(), IsContentDocument() ? 1 : 0,
          IsInChromeDocShell() ? 1 : 0, bcIsContent,
          NodePrincipal()->IsSystemPrincipal() ? 1 : 0, hasParentDoc ? 1 : 0,
          hasParentDoc ? 0 : 1);
      fclose(fp);
    }
    SpeculumAttachMutationObserverToDocument(this);
  } else {
    SpeculumDetachMutationObserverFromDocument(this);
  }
}
"""

start = text.find("void Document::SetSpeculumWatchingDOMMutations(bool aValue) {")
if start == -1:
    raise SystemExit("SetSpeculumWatching not found")
end = text.find("\n\n\nvoid EvaluateMediaQueryLists", start)
if end == -1:
    raise SystemExit("end not found")
text = text[:start] + fn + text[end:]

hook = """  AsyncEventDispatcher::RunDOMEventWhenSafe(
      *this, u"readystatechange"_ns, CanBubble::eNo, ChromeOnlyDispatch::eNo);

  if (aReadyState == READYSTATE_COMPLETE && mSpeculumWatchingDOMMutations) {
    SpeculumTryWriteBootstrapFrame(this);
  }
}"""

old_tail = """  AsyncEventDispatcher::RunDOMEventWhenSafe(
      *this, u"readystatechange"_ns, CanBubble::eNo, ChromeOnlyDispatch::eNo);

}"""

if "SpeculumTryWriteBootstrapFrame(this)" not in text:
    if old_tail not in text:
        raise SystemExit("SetReadyStateInternal tail not found")
    text = text.replace(old_tail, hook, 1)

p.write_text(text)
print("ok")
