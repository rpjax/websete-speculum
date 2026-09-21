#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
text = p.read_text()
start = text.find("void Document::SetSpeculumWatchingDOMMutations(bool aValue) {")
if start == -1:
    raise SystemExit("function not found")
end = text.find("\n\n\nvoid EvaluateMediaQueryLists", start)
if end == -1:
    raise SystemExit("end not found")
includes_need = '#include "mozilla/dom/BrowsingContext.h"\n'
replacement = """void Document::SetSpeculumWatchingDOMMutations(bool aValue) {
  if (mSpeculumWatchingDOMMutations == aValue || mIsGoingAway) {
    return;
  }
  if (aValue) {
    if (IsInChromeDocShell()) {
      return;
    }
    if (nsIDocShell* shell = GetDocShell()) {
      if (BrowsingContext* bc = shell->GetBrowsingContext()) {
        if (!bc->IsContent()) {
          return;
        }
      }
    }
  }
  mSpeculumWatchingDOMMutations = aValue;
  if (aValue) {
    printf_stderr("[SPECULUM] attach (StartDocumentLoad)\\n");
    SpeculumAttachMutationObserverToDocument(this);
  } else {
    SpeculumDetachMutationObserverFromDocument(this);
  }
}
"""
text = text[:start] + replacement + text[end:]
if includes_need.strip() not in text:
    text = text.replace(
        '#include "SpeculumNodeSource.h"\n',
        '#include "SpeculumNodeSource.h"\n' + includes_need,
        1,
    )
p.write_text(text)
print("repaired")
