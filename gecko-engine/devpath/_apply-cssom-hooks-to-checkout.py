#!/usr/bin/env python3
"""Aplica no checkout as 6 linhas de gancho CSSOM que existem no espelho e faltam lá.

Motivo: `SpeculumCssom.cpp` compila no checkout (`moz.build` lista) mas nenhuma função
dele tem call site — as chamadas em `Document.cpp` só existem no espelho do repo.
Binário sem call site = CSSOM vivo não emite nada (medido: captures/cssom-late-*).

Idempotente: se a linha já está lá, não faz nada. Não altera mais nada do arquivo.
"""
import re
import sys
from pathlib import Path

GECKO = Path(sys.argv[1] if len(sys.argv) > 1 else '/root/speculum-gecko/checkout')
DOC = GECKO / 'dom/base/Document.cpp'

# (âncora exata no checkout, linha a inserir depois dela)
EDITS = [
    ('#include "SpeculumNodeSource.h"\n', '#include "SpeculumCssom.h"\n'),
    (
        'void Document::InsertSheetAt(size_t aIndex, StyleSheet& aSheet) {\n'
        '  DocumentOrShadowRoot::InsertSheetAt(aIndex, aSheet);\n',
        '  SpeculumNotifySheetAdded(this, &aSheet);\n',
    ),
    (
        'void Document::PostStyleSheetRemovedEvent(StyleSheet& aSheet) {\n',
        '  SpeculumNotifySheetRemoved(this, &aSheet);\n',
    ),
    (
        'void Document::RuleChanged(StyleSheet& aSheet, css::Rule* aRule,\n'
        '                           const StyleRuleChange&) {\n',
        '  SpeculumNotifyRuleChanged(this, aRule);\n',
    ),
    (
        'void Document::RuleAdded(StyleSheet& aSheet, css::Rule& aRule) {\n'
        '  if (aRule.IsIncompleteImportRule()) {\n'
        '    return;\n'
        '  }\n\n',
        '  SpeculumNotifyRuleAdded(this, &aSheet, aRule);\n\n',
    ),
    (
        'void Document::RuleRemoved(StyleSheet& aSheet, css::Rule& aRule) {\n',
        '  SpeculumNotifyRuleRemoved(this, &aSheet, aRule);\n',
    ),
    (
        'void Document::StyleSheetApplicableStateChanged(StyleSheet& aSheet) {\n',
        '  SpeculumNotifySheetApplicable(this, &aSheet);\n',
    ),
]

text = DOC.read_text(encoding='utf-8')
applied, already, missing = [], [], []

# `Document::RuleChanged` chega com o `css::Rule*` sem nome no checkout; o gancho
# precisa do parâmetro nomeado. Nomear é pré-requisito, não mudança de comportamento.
UNNAMED = 'void Document::RuleChanged(StyleSheet& aSheet, css::Rule*,\n'
NAMED = 'void Document::RuleChanged(StyleSheet& aSheet, css::Rule* aRule,\n'
if UNNAMED in text:
    text = text.replace(UNNAMED, NAMED, 1)
    applied.append('nomeia aRule em Document::RuleChanged')

for anchor, line in EDITS:
    tag = line.strip()
    if tag in text:
        already.append(tag)
        continue
    if anchor not in text:
        missing.append(tag)
        continue
    text = text.replace(anchor, anchor + line, 1)
    applied.append(tag)

if applied:
    DOC.write_text(text, encoding='utf-8')

for t in applied:
    print(f'aplicado  {t}')
for t in already:
    print(f'já estava {t}')
for t in missing:
    print(f'ANCORA NAO ENCONTRADA {t}')

print(f'\ntotal speculum no Document.cpp: {len(re.findall("(?i)speculum", text))}')
sys.exit(1 if missing else 0)
