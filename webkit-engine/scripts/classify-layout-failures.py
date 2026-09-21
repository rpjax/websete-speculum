#!/usr/bin/env python3
"""Classify layout-test unexpected failures into baseline buckets."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CHECKOUT = Path(__file__).resolve().parents[2]
if not (CHECKOUT / "Tools/Scripts/webkitpy").exists():
    CHECKOUT = Path("/root/speculum-webkit/checkout")

sys.path.insert(0, str(CHECKOUT / "Tools/Scripts"))

from webkitpy.common.system.systemhost import SystemHost
from webkitpy.layout_tests.models.test_expectations import TestExpectations
from webkitpy.port.factory import PortFactory

FAIL_LINE = re.compile(
    r"\[\d+/85179\] (.+?) failed (?:unexpectedly )?\((.+)\)$"
)

ENV_PATTERNS: list[tuple[str, str]] = [
    (r"^webrtc/", "WebRTC real peer/media stack indisponível na WSL headless (sem rede/camera/mic real)"),
    (r"^fast/mediastream/", "MediaStream/WebRTC indisponível na WSL headless"),
    (r"^http/tests/webrtc/", "WebRTC HTTP tests — sem stack de mídia/rede real na WSL"),
    (r"^imported/w3c/web-platform-tests/webrtc", "WPT WebRTC — sem stack de mídia/rede real na WSL"),
    (r"^media/", "Codecs/mídia hardware ou demux — WSL sem GPU/aceleração de vídeo confiável"),
    (r"^http/wpt/mediarecorder/", "MediaRecorder — codecs/capture indisponíveis na WSL"),
    (r"^http/tests/webcodecs/", "WebCodecs — decoders hardware ausentes na WSL"),
    (r"^http/tests/media/", "HTTP media tests — codecs/streaming indisponíveis na WSL"),
    (r"^compositing/", "Compositing/GPU — WSL sem GPU/DRI utilizável (GBM/DRM falham)"),
    (r"^webgl/", "WebGL/GPU — WSL sem GPU utilizável"),
    (r"^fast/canvas/webgl", "WebGL/GPU — WSL sem GPU utilizável"),
    (r"^http/tests/multipart/", "Multipart streaming HTTP — timing/servidor de teste na WSL"),
]


def extract_failures(log_path: Path) -> list[tuple[str, str]]:
    text = log_path.read_text(encoding="utf-8", errors="replace")
    if "Retrying" in text:
        text = text.split("Retrying", 1)[0]
    failures: dict[str, str] = {}
    for line in text.splitlines():
        m = FAIL_LINE.search(line.strip())
        if m:
            failures[m.group(1)] = m.group(2)
    return sorted(failures.items())


def is_expected(expectations: TestExpectations, test: str) -> bool:
    label = expectations.model().get_expectations_string(test)
    return label != "PASS"


def env_cause(test: str) -> str | None:
    for pattern, cause in ENV_PATTERNS:
        if re.search(pattern, test):
            return cause
    return None


def main() -> int:
    log_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/root/speculum-webkit/baseline/layout-tests-rerun.log")
    failures = extract_failures(log_path)
    if not failures:
        print(json.dumps({"error": "no failures parsed", "log": str(log_path)}, indent=2))
        return 1

    host = SystemHost()
    port = PortFactory(host).get("wpe", None)
    test_names = [t for t, _ in failures]
    expectations = TestExpectations(port, test_names)
    expectations.parse_all_expectations()

    bucket1: list[str] = []
    bucket2: list[dict[str, str]] = []
    bucket3: list[dict[str, str]] = []

    for test, reason in failures:
        if is_expected(expectations, test):
            bucket1.append(test)
            continue
        cause = env_cause(test)
        if cause:
            bucket2.append({"test": test, "reason": reason, "cause": cause})
            continue
        bucket3.append({"test": test, "reason": reason, "raw": f"{test} failed ({reason})"})

    total = len(failures)

    def pct(n: int) -> str:
        return f"{100.0 * n / total:.1f}%" if total else "0%"

    out = {
        "total_unexpected": total,
        "bucket1_expected": {"count": len(bucket1), "pct": pct(len(bucket1))},
        "bucket2_environment": {"count": len(bucket2), "pct": pct(len(bucket2))},
        "bucket3_unexplained": {"count": len(bucket3), "pct": pct(len(bucket3)), "items": bucket3},
    }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
