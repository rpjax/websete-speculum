#!/usr/bin/env python3
import json, os, collections, glob

dossiers = sorted(glob.glob("/tmp/speculum-lab-runs/20260917-07*-fc149f6cbbd4"))
if not dossiers:
    dossiers = sorted(glob.glob("/tmp/speculum-lab-runs/20260917-*"))[-5:]
print("DOSSIERS", dossiers)
for d in dossiers:
    print("\n====", d, "====")
    print("files", os.listdir(d))
    for name in ("manifest.json", "crash.json", "projected-snapshot.json"):
        p = os.path.join(d, name)
        if os.path.isfile(p):
            print(name, open(p, encoding="utf-8", errors="replace").read()[:2500])

    for fname in ("telemetry.ndjson", "projected.ndjson"):
        p = os.path.join(d, fname)
        if not os.path.isfile(p):
            continue
        kinds = collections.Counter()
        interesting = []
        last = []
        gens = collections.Counter()
        resync_true = 0
        with open(p, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                last.append((i, line[:350]))
                if len(last) > 12:
                    last.pop(0)
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                t = o.get("type") or o.get("kind") or o.get("event") or "?"
                kinds[t] += 1
                blob = line.lower()
                if any(k in blob for k in ("resync", "desync", "crash", "malformed", "lag", "click", "input", "armed", "nested", "gap", "overrun", "fault")):
                    if len(interesting) < 80:
                        interesting.append((i, line[:600]))
                if o.get("resync") is True:
                    resync_true += 1
                if "generation" in o:
                    gens[o.get("generation")] += 1
        print(fname, "kinds", kinds.most_common(30))
        print("resync_true_frames", resync_true, "gens", gens.most_common(8))
        print("INTERESTING", len(interesting))
        for i, l in interesting:
            print(" ", i, l)
        print("TAIL")
        for i, l in last:
            print(" ", i, l)
