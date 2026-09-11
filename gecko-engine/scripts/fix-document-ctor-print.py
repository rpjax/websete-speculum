#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
lines = p.read_text().splitlines()
out = []
skip = False
for i, line in enumerate(lines):
    if skip:
        if line.strip() in ('");', '");') or "SPECULUM-CTOR" in line:
            continue
        skip = False
    if "SpeculumAttachMutationObserverToDocument(this)" in line:
        out.append("  SpeculumAttachMutationObserverToDocument(this);")
        out.append('  fprintf(stderr, "[SPECULUM-CTOR]\\n");')
        skip = True
        continue
    out.append(line)
p.write_text("\n".join(out) + "\n")
for j, ln in enumerate(out):
    if "Speculum" in ln:
        print(f"{j + 1}: {ln}")
