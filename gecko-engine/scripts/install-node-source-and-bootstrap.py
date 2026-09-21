#!/usr/bin/env python3
from pathlib import Path

repo = Path("/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum")
checkout = Path("/root/speculum-gecko/checkout")

for name in ("SpeculumNodeSource.h", "SpeculumNodeSource.cpp"):
    (checkout / "dom/base" / name).write_text(
        (repo / "gecko-engine/patches" / name).read_text()
    )

doc = checkout / "dom/base/Document.cpp"
text = doc.read_text()
if "SpeculumNodeSource.h" not in text:
    text = text.replace(
        '#include "SpeculumMutationObserver.h"\n',
        '#include "SpeculumMutationObserver.h"\n'
        '#include "SpeculumNodeSource.h"\n\n'
        "#include <cstdio>\n"
        "#include <sys/stat.h>\n"
        "#include <sys/types.h>\n"
        "#include <vector>\n",
        1,
    )

needle = "    SpeculumAttachMutationObserverToDocument(this);\n"
schedule = needle + "    SpeculumScheduleBootstrapFrame(this);\n"
if "SpeculumScheduleBootstrapFrame" not in text:
    if needle not in text:
        raise SystemExit("attach needle missing")
    text = text.replace(needle, schedule, 1)

# Remove inline bootstrap if a prior install left it.
old_inline = """    SpeculumNodeSource source;
    speculum::Producer producer(source);
    producer.bootstrap(this);
"""
if old_inline in text:
    start = text.find(old_inline)
    end = text.find("    }\n", start)
    if end != -1:
        text = text[:start] + text[end + 6 :]

doc.write_text(text)

moz = checkout / "dom/base/moz.build"
moz_text = moz.read_text()
entry = '    "SpeculumNodeSource.cpp",\n'
if entry not in moz_text:
    moz_text = moz_text.replace(
        '    "SpeculumMutationObserver.cpp",\n',
        '    "SpeculumMutationObserver.cpp",\n' + entry,
        1,
    )
    moz.write_text(moz_text)

print("installed")
