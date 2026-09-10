#!/usr/bin/env python3
"""Parse Gecko baseline logs for harness summaries (read-only)."""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "speculum-gecko/baseline")


def tail_summary(text: str, suite: str) -> None:
    for line in text.splitlines():
        if line.startswith("Ran ") or line.startswith("Expected results:") or line.startswith(
            "Unexpected results:"
        ):
            print(f"{suite}: {line}")


def mochitest(path: Path) -> None:
    log = path.read_text(errors="replace")
    starts = log.count("TEST_START:")
    ends = log.count("TEST_END:")
    unexp_lines = []
    total = 0
    passed_sub = 0
    total_sub = 0
    for line in log.splitlines():
        if "TEST_END:" not in line:
            continue
        sm = re.search(r"Subtests passed (\d+)/(\d+)", line)
        if sm:
            passed_sub += int(sm.group(1))
            total_sub += int(sm.group(2))
        m = re.search(r"Unexpected (\d+)", line)
        if m and int(m.group(1)) > 0:
            total += int(m.group(1))
            unexp_lines.append(line.strip())
    print(f"mochitest: TEST_START={starts} TEST_END={ends} incomplete={starts != ends}")
    print(f"mochitest: subtests_passed={passed_sub}/{total_sub} (harness incomplete, no final summary)")
    print(f"mochitest: tests_with_unexpected>0={len(unexp_lines)} sum_Unexpected_field={total}")
    tail_summary(log, "mochitest")


def xpcshell(path: Path) -> None:
    log = path.read_text(errors="replace")
    tail_summary(log, "xpcshell")
    err = re.search(r"Error Summary\n-+\n(.*)", log, re.S)
    if err:
        block = err.group(1).split("\n\n")[0:80]
        print("xpcshell_error_summary_lines:", len(block))


def wpt(path: Path) -> None:
    if not path.exists():
        print("wpt: (no log yet)")
        return
    log = path.read_text(errors="replace")
    for line in log.splitlines()[-30:]:
        if "Unexpected" in line or "Expected" in line or line.startswith("Ran"):
            print("wpt_tail:", line)


if __name__ == "__main__":
    base = ROOT
    xpcshell(base / "xpcshell-test.log")
    mochitest(base / "mochitest.log")
    wpt(base / "web-platform-tests.log")
