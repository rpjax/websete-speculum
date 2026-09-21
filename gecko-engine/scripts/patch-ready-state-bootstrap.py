#!/usr/bin/env python3
from pathlib import Path

p = Path("/root/speculum-gecko/checkout/dom/base/Document.cpp")
text = p.read_text()
needle = """  AsyncEventDispatcher::RunDOMEventWhenSafe(
      *this, u"readystatechange"_ns, CanBubble::eNo, ChromeOnlyDispatch::eNo);
}"""
insert = """  AsyncEventDispatcher::RunDOMEventWhenSafe(
      *this, u"readystatechange"_ns, CanBubble::eNo, ChromeOnlyDispatch::eNo);

  if (aReadyState == READYSTATE_COMPLETE && mSpeculumWatchingDOMMutations) {
    SpeculumTryWriteBootstrapFrame(this);
  }
}"""
if "SpeculumTryWriteBootstrapFrame" not in text:
    if needle not in text:
        raise SystemExit("SetReadyStateInternal tail not found")
    text = text.replace(needle, insert, 1)
    p.write_text(text)
    print("hooked SetReadyStateInternal")
else:
    print("already hooked")
