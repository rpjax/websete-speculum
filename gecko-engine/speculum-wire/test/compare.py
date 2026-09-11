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
print("FALHOU" if fail else "OK — paridade C++ <-> TypeScript")
sys.exit(1 if fail else 0)
