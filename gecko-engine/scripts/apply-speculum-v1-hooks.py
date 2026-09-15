#!/usr/bin/env python3
"""Gancho nativo de alerta/confirma/prompt no checkout. Sem auto-ok."""

from pathlib import Path
import os
import sys

CHECKOUT = Path(os.environ.get("GECKO", os.path.expanduser("~/speculum-gecko/checkout")))
TARGET = CHECKOUT / "dom/base/nsGlobalWindowInner.cpp"
INCLUDE = '#include "SpeculumMarionette.h"\n'

HOOK = """
  {
    uint32_t specCtx = 0;
    if (mozilla::dom::BrowsingContext* specBc = GetBrowsingContext()) {
      specCtx = specBc->GetSpeculumContextId();
    }
    if (specCtx) {
      nsAutoCString specAns;
      NS_ConvertUTF16toUTF8 specDesc(%(msg)s);
      if (SpeculumAskAndWait(specCtx, SpeculumAskKind::Dialog, specDesc, specAns)) {
        %(ret)s
      }
    }
  }
"""


def insert_after_brace(text: str, needle: str, body: str) -> str:
    i = text.find(needle)
    if i < 0:
        return text
    j = text.find("{", i)
    if j < 0:
        return text
    if "SpeculumAskAndWait" in text[j : j + 400]:
        return text
    return text[: j + 1] + body + text[j + 1 :]


def main() -> int:
    if not TARGET.is_file():
        print(f"skip: {TARGET} ausente")
        return 0
    text = TARGET.read_text(encoding="utf-8", errors="replace")
    if INCLUDE not in text:
        inc = '#include "nsGlobalWindowInner.h"\n'
        if inc in text:
            text = text.replace(inc, inc + INCLUDE, 1)
        else:
            text = INCLUDE + text

    text = insert_after_brace(
        text,
        "nsGlobalWindowInner::Alert(",
        HOOK
        % {
            "msg": "aMessage",
            "ret": "return;",
        },
    )
    text = insert_after_brace(
        text,
        "nsGlobalWindowInner::Confirm(",
        HOOK
        % {
            "msg": "aMessage",
            "ret": "return specAns.EqualsLiteral(\"1\") || specAns.EqualsLiteral(\"ok\");",
        },
    )
    text = insert_after_brace(
        text,
        "nsGlobalWindowInner::Prompt(",
        HOOK
        % {
            "msg": "aMessage",
            "ret": "CopyUTF8toUTF16(specAns, aReturn); return;",
        },
    )
    TARGET.write_text(text, encoding="utf-8")
    print(f"hooked {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
