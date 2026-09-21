from pathlib import Path
from collections import Counter
import json
from urllib.parse import urlparse

cap = Path(
    "/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/"
    "gecko-engine/devpath/captures/resync-502-20260916-235322Z"
)
sw = Counter()
status = Counter()
why = Counter()
hosts502 = Counter()
hosts403 = Counter()
decode = []
for line in (cap / "trace.ndjson").read_text(errors="replace").splitlines():
    try:
        r = json.loads(line)
    except Exception:
        continue
    hop = r.get("hop")
    if hop:
        sw[hop] += 1
        if hop == "sw.respond":
            st = r.get("status")
            status[st] += 1
            host = urlparse(r.get("url", "")).netloc
            if st == 502:
                why[r.get("why")] += 1
                hosts502[host] += 1
            if st in (403, 404):
                hosts403[f"{st}:{host}"] += 1
    if r.get("event") == "decode_fail":
        decode.append(r)

print("hops", sw.most_common())
print("sw status", dict(status))
print("502 why", dict(why), "hosts", dict(hosts502))
print("403/404", dict(hosts403))
print("decode_fail", len(decode))
for r in decode[:12]:
    u = r.get("url", "")
    meta = {k: r[k] for k in r if k != "url"}
    print("DEC", u[:130])
    print(" ", meta)
