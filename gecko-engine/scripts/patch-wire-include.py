#!/usr/bin/env python3
from pathlib import Path

moz = Path("/root/speculum-gecko/checkout/dom/base/moz.build")
text = moz.read_text()
if '    "/third_party/speculum-wire/include",\n    "/third_party/xsimd/include",\n' not in text:
    text = text.replace(
        '    "/third_party/xsimd/include",\n    "/third_party/speculum-wire/include",\n',
        '    "/third_party/speculum-wire/include",\n    "/third_party/xsimd/include",\n',
        1,
    )
    moz.write_text(text)

cpp = Path("/root/speculum-gecko/checkout/dom/base/SpeculumMutationObserver.cpp")
text = cpp.read_text()
wire = """
#define SPECULUM_FATAL(msg) MOZ_CRASH(msg)
#include "speculum/Producer.h"
"""
if "speculum/Producer.h" not in text:
    text = text.replace(
        '#include "nsDebug.h"\n',
        '#include "mozilla/Assertions.h"\n#include "nsDebug.h"\n\n' + wire + "\n",
        1,
    )
old = (
    "void SpeculumMutationObserver::ContentInserted(nsIContent*,\n"
    "                                               const ContentInsertInfo&) {\n"
    '  SPECULUM_LOG("ContentInserted");\n'
    "}"
)
new = (
    "void SpeculumMutationObserver::ContentInserted(nsIContent*,\n"
    "                                               const ContentInsertInfo&) {\n"
    '  printf_stderr("[SPECULUM] wire ok, prefix=%zu\\n", speculum::kFramePrefixBytes);\n'
    '  SPECULUM_LOG("ContentInserted");\n'
    "}"
)
if "wire ok" not in text:
    if old not in text:
        raise SystemExit("ContentInserted block not found")
    text = text.replace(old, new, 1)
cpp.write_text(text)
print("ok")
