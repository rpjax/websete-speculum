#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
text = p.read_text()
devtools_fn = """void Document::SetDevToolsWatchingDOMMutations(bool aValue) {
  if (mDevToolsWatchingDOMMutations == aValue || mIsGoingAway) {
    return;
  }
  mDevToolsWatchingDOMMutations = aValue;
  if (aValue) {
    if (MOZ_UNLIKELY(!sDevToolsMutationObserver)) {
      sDevToolsMutationObserver = new DevToolsMutationObserver();
      ClearOnShutdown(&sDevToolsMutationObserver);
    }
    AddMutationObserver(sDevToolsMutationObserver);
  } else if (sDevToolsMutationObserver) {
    RemoveMutationObserver(sDevToolsMutationObserver);
  }
}"""
speculum_fn = """

void Document::SetSpeculumWatchingDOMMutations(bool aValue) {
  if (mSpeculumWatchingDOMMutations == aValue || mIsGoingAway) {
    return;
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
if "void Document::SetSpeculumWatchingDOMMutations" not in text:
    if devtools_fn not in text:
        raise SystemExit("DevTools fn not found")
    text = text.replace(devtools_fn, devtools_fn + speculum_fn, 1)
    p.write_text(text)
    print("inserted SetSpeculumWatchingDOMMutations")
else:
    print("already present")
