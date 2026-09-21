#!/usr/bin/env python3
"""Compara os hashes C++ x TS e confere que o CHECK no fio bate com o tableHash."""
import json, sys, pathlib

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/speculum-wire")
cpp = json.loads((out / "hashes_cpp.json").read_text())
ts = json.loads((out / "hashes_ts.json").read_text())
dec = json.loads((out / "decoded.json").read_text())

fail = False
bad = [k for k in cpp if cpp[k] != ts.get(k)]
print(f"hash fixtures: {len(cpp)} | divergentes: {len(bad)}")
for k in bad:
    print(f"  X {k}: cpp={cpp[k]} ts={ts[k]}")
    fail = True

checks = [o for o in dec["ops"] if o["op"] == 1]
if not checks:
    print("  X nenhum CHECK no frame"); fail = True
elif checks[0]["hash"] != cpp["tableHash"] or checks[0]["hash"] != ts["tableHash"]:
    print(f"  X CHECK no fio {checks[0]['hash']} != tableHash"); fail = True
else:
    print("CHECK no fio == tableHash (C++ e TS)")

print(f"ops decodificadas pelo cliente: {dec['opCount']}")
# ---- tabela replicada, passo a passo ----
tc = json.loads((out / "table_cpp.json").read_text())
tt = json.loads((out / "table_ts.json").read_text())
if len(tc) != len(tt):
    print(f"  X trace de tamanhos diferentes: cpp={len(tc)} ts={len(tt)}"); fail = True
else:
    diverged = 0
    for a, b in zip(tc, tt):
        if a["tableHash"] != b["tableHash"] or a["size"] != b["size"] or a["children"] != b["children"]:
            diverged += 1
            if diverged <= 3:
                print(f"  X linha {a['line']} `{a['cmd']}`")
                print(f"      cpp hash={a['tableHash']} size={a['size']} children={a['children']}")
                print(f"      ts  hash={b['tableHash']} size={b['size']} children={b['children']}")
    if diverged:
        print(f"  X {diverged}/{len(tc)} passos divergentes"); fail = True
    else:
        print(f"tabela replicada: {len(tc)}/{len(tc)} passos identicos (tableHash, size, ordem de filhos)")

# ---- laço do produtor: C++ emite, cliente aplica com o apply estrito ----
pc = json.loads((out / "producer_cpp.json").read_text())
pt = json.loads((out / "producer_ts.json").read_text())
if pt.get("failed"):
    print(f"  X cliente recusou: {pt['failed']}"); fail = True
elif pc["frames"] != pt["frames"] or pc["rows"] != pt["rows"] or pc["tableHash"] != pt["tableHash"]:
    print("  X produtor e cliente divergem")
    print(f"      cpp frames={pc['frames']} rows={pc['rows']} hash={pc['tableHash']}")
    print(f"      ts  frames={pt['frames']} rows={pt['rows']} hash={pt['tableHash']}")
    fail = True
else:
    print(f"laco do produtor: {pc['frames']} frames aceitos pelo apply estrito; "
          f"{pc['rows']} linhas, tableHash igual dos dois lados")

print("FALHOU" if fail else "OK — paridade C++ <-> TypeScript")
sys.exit(1 if fail else 0)
