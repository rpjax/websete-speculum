#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
text = p.read_text()
start = text.find("    SpeculumNodeSource source;")
if start == -1:
    print("no inline bootstrap")
else:
    depth = 0
    i = start
    while i < len(text):
        if text[i : i + 1] == "{":
            depth += 1
        elif text[i : i + 1] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                if text[end : end + 1] == "\n":
                    end += 1
                text = text[:start] + text[end:]
                break
        i += 1
    p.write_text(text)
    print("removed inline bootstrap")

needle = "    SpeculumAttachMutationObserverToDocument(this);\n"
schedule = needle + "    SpeculumScheduleBootstrapFrame(this);\n"
if "SpeculumScheduleBootstrapFrame" not in text:
    text = p.read_text()
    text = text.replace(needle, schedule, 1)
    p.write_text(text)
    print("added schedule")
