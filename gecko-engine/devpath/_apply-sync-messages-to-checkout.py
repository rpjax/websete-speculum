#!/usr/bin/env python3
"""Garante as mensagens sync Speculum em ipc/ipdl/sync-messages.ini.

O IPDL recusa `export` se a mensagem sync não estiver neste arquivo
(`Unknown sync IPC message`). Idempotente.
"""
import sys
from pathlib import Path

GECKO = Path(sys.argv[1] if len(sys.argv) > 1 else '/root/speculum-gecko/checkout')
INI = GECKO / 'ipc/ipdl/sync-messages.ini'

ENTRIES = [
    (
        '[PContent::SpeculumMintContextId]',
        'description = Speculum nested contextId must exist in the BrowsingContext birth snapshot before StartDocumentLoad; one sync hop per iframe lifetime, never per frame\n',
    ),
    (
        '[PContent::SpeculumClaimGeneration]',
        'description = Speculum document epoch: one claim per Document attach; producer writes generation, parent never stamps the payload\n',
    ),
    (
        '[PContent::SpeculumDialogRequested]',
        'description = Speculum native alert/confirm/prompt: content asks parent so Requested is on the wire before the content process waits for Respond\n',
    ),
    (
        '[PContent::SpeculumPermissionRequested]',
        'description = Speculum permission prompt: same sync hop as dialog, parent emits Requested before content waits\n',
    ),
    (
        '[PContent::SpeculumDownloadRequested]',
        'description = Speculum download prompt: same sync hop as dialog, parent emits Requested before content waits\n',
    ),
]

text = INI.read_text(encoding='utf-8')
missing = [(h, d) for h, d in ENTRIES if h not in text]
already = [h for h, _ in ENTRIES if h in text]
if missing:
    chunk = ''.join(h + '\n' + d for h, d in missing)
    mint = '[PContent::SpeculumMintContextId]\n'
    if mint in text:
        desc_nl = text.find('\n', text.find(mint) + len(mint))
        insert_at = desc_nl + 1 if desc_nl != -1 else text.find(mint)
        text = text[:insert_at] + chunk + text[insert_at:]
    else:
        text = text.rstrip() + '\n' + chunk
    INI.write_text(text, encoding='utf-8')

for h, _ in missing:
    print(f'aplicado  {h}')
for h in already:
    print(f'já estava {h}')
sys.exit(0)
