#!/usr/bin/env python3
"""Gancho nativo em Element::AttachShadowWithoutNameChecks. Idempotente."""
import sys
from pathlib import Path

GECKO = Path(sys.argv[1] if len(sys.argv) > 1 else '/root/speculum-gecko/checkout')
SRC = GECKO / 'dom/base/Element.cpp'

INCLUDE = '#include "SpeculumMutationObserver.h"\n'
HOOK = '  SpeculumNotifyShadowAttached(this, shadowRoot);\n'
ANCHOR = "  // 13. Set element's shadow root to shadow.\n  SetShadowRoot(shadowRoot);\n"
INCLUDE_AFTER = '#include "mozilla/dom/Element.h"\n'

text = SRC.read_text(encoding='utf-8')
applied = []

if INCLUDE.strip() not in text:
    if INCLUDE_AFTER not in text:
        print('ANCORA NAO ENCONTRADA include Element.h')
        sys.exit(1)
    text = text.replace(INCLUDE_AFTER, INCLUDE_AFTER + INCLUDE, 1)
    applied.append('include SpeculumMutationObserver.h')
else:
    print('já estava include SpeculumMutationObserver.h')

if 'SpeculumNotifyShadowAttached(this, shadowRoot)' in text:
    print('já estava SpeculumNotifyShadowAttached')
else:
    if ANCHOR not in text:
        print('ANCORA NAO ENCONTRADA SetShadowRoot')
        sys.exit(1)
    text = text.replace(ANCHOR, ANCHOR + HOOK, 1)
    applied.append('SpeculumNotifyShadowAttached')

if applied:
    SRC.write_text(text, encoding='utf-8')
    for t in applied:
        print(f'aplicado  {t}')
print('DONE')
sys.exit(0)
