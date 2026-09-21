#!/usr/bin/env python3
from pathlib import Path

checkout = Path("/root/speculum-gecko/checkout")
repo = Path("/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/patches")


def patch_document_cpp():
    p = checkout / "dom/base/Document.cpp"
    text = p.read_text()
    old_ctor = """  mPreloadReferrerInfo = new dom::ReferrerInfo(nullptr);
  mReferrerInfo = new dom::ReferrerInfo(nullptr);
  fprintf(stderr, "[SPECULUM-CTOR]\\n");
  SpeculumAttachMutationObserverToDocument(this);
}"""
    new_ctor = """  mPreloadReferrerInfo = new dom::ReferrerInfo(nullptr);
  mReferrerInfo = new dom::ReferrerInfo(nullptr);
}"""
    if old_ctor not in text:
        raise SystemExit("ctor block not found")
    text = text.replace(old_ctor, new_ctor, 1)

    needle = (
        "  MOZ_ASSERT(GetReadyStateEnum() == Document::READYSTATE_UNINITIALIZED,\n"
        '             "Bad readyState");\n'
        "  SetReadyStateInternal(READYSTATE_LOADING);"
    )
    insert = needle + "\n\n  SetSpeculumWatchingDOMMutations(true);"
    if "SetSpeculumWatchingDOMMutations(true)" not in text:
        if needle not in text:
            raise SystemExit("StartDocumentLoad needle not found")
        text = text.replace(needle, insert, 1)

    destroy_needle = "  SetDevToolsWatchingDOMMutations(false);"
    destroy_insert = (
        "  SetSpeculumWatchingDOMMutations(false);\n"
        "  SetDevToolsWatchingDOMMutations(false);"
    )
    if "SetSpeculumWatchingDOMMutations(false)" not in text:
        text = text.replace(destroy_needle, destroy_insert, 1)

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
    print("Document.cpp patched")


def patch_document_h():
    p = checkout / "dom/base/Document.h"
    text = p.read_text()
    if "SetSpeculumWatchingDOMMutations" not in text:
        text = text.replace(
            "  void SetDevToolsWatchingDOMMutations(bool aValue);\n",
            "  void SetDevToolsWatchingDOMMutations(bool aValue);\n"
            "  void SetSpeculumWatchingDOMMutations(bool aValue);\n",
            1,
        )
    if "mSpeculumWatchingDOMMutations" not in text:
        text = text.replace(
            "  bool mDevToolsWatchingDOMMutations : 1;\n",
            "  bool mDevToolsWatchingDOMMutations : 1;\n"
            "  bool mSpeculumWatchingDOMMutations : 1;\n",
            1,
        )
    p.write_text(text)
    print("Document.h patched")


def patch_observer_cpp():
    p = checkout / "dom/base/SpeculumMutationObserver.cpp"
    text = p.read_text()
    text = text.replace("#include <cstdio>\n\n", "")
    if "nsDebug.h" not in text:
        text = text.replace(
            '#include "mozilla/dom/Document.h"\n',
            '#include "mozilla/dom/Document.h"\n#include "nsDebug.h"\n',
            1,
        )
    text = text.replace(
        '#define SPECULUM_LOG(cb) fprintf(stderr, "[SPECULUM] %s\\n", cb)',
        '#define SPECULUM_LOG(cb) printf_stderr("[SPECULUM] %s\\n", cb)',
    )
    if "SpeculumDetachMutationObserverFromDocument" not in text:
        text = text.rstrip() + """

void SpeculumDetachMutationObserverFromDocument(Document* aDocument) {
  if (!aDocument || !sSpeculumMutationObserver) {
    return;
  }
  aDocument->RemoveMutationObserver(sSpeculumMutationObserver);
}
"""
    p.write_text(text)
    print("SpeculumMutationObserver.cpp patched")


def patch_observer_h():
    p = checkout / "dom/base/SpeculumMutationObserver.h"
    text = p.read_text()
    if "SpeculumDetachMutationObserverFromDocument" not in text:
        text = text.replace(
            "void SpeculumAttachMutationObserverToDocument(mozilla::dom::Document* aDocument);\n",
            "void SpeculumAttachMutationObserverToDocument(mozilla::dom::Document* aDocument);\n"
            "void SpeculumDetachMutationObserverFromDocument(mozilla::dom::Document* aDocument);\n",
            1,
        )
    p.write_text(text)
    print("SpeculumMutationObserver.h patched")


def main():
    patch_document_cpp()
    patch_document_h()
    patch_observer_cpp()
    patch_observer_h()
    repo.mkdir(parents=True, exist_ok=True)
    for name in ["SpeculumMutationObserver.cpp", "SpeculumMutationObserver.h"]:
        src = checkout / "dom/base" / name
        (repo / name).write_text(src.read_text())
    print("patches synced")


if __name__ == "__main__":
    main()
