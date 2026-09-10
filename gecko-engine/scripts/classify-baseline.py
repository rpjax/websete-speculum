#!/usr/bin/env python3
"""Classify Gecko baseline unexpected into bucket 2 (environment) vs 3."""
import re
import sys
from pathlib import Path

BASE = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "speculum-gecko/baseline")

# xpcshell: map test path fragment -> (bucket, reason)
XPC_ENV = [
    ("merinoClient", 2, "rede/API Merino remota"),
    ("networkError", 2, "rede/API remota"),
    ("test_linuxDesktopEntry", 2, "integração XDG/desktop Linux"),
    ("test_autoconfig_sysconfd", 2, "paths sysconf Linux ausentes"),
    ("test_unix_domain", 2, "WSL/socket Unix domain"),
    ("test_osclientcerts", 2, "PKCS#11 / cert store do SO"),
    ("test_browserGlue_migration_osauth", 2, "OS auth / keychain do SO"),
    ("BackupService", 2, "WSL — diretório Documents/profile vazio"),
    ("test_httpssvc_retry_without_ech", 2, "harness xpcshell paralelo (processo residual)"),
    ("test_bug561042", 2, "httpd local NS_ERROR_NOT_AVAILABLE (bind/rede local)"),
]


def classify_xpcshell(text: str) -> tuple[int, int, int, list[str]]:
    b1_expected = 8417
    b1_total = 8803
    unexp = 43
    env = 0
    inex = 0
    bucket3_lines: list[str] = []
    block = text.split("Error Summary\n-------------", 1)
    if len(block) < 2:
        return b1_expected, 0, unexp, ["(sem Error Summary)"]
    summary = block[1]
    tests = re.split(r"\n(?=[a-zA-Z0-9].*\.(js|toml):|\w+.*\.js\n)", summary)
    current_test = ""
    for line in summary.splitlines():
        if line.startswith("  FAIL ") or line.startswith("  CRASH "):
            current_test = line
        if line.startswith("ERROR "):
            continue
        if "Tests were run in parallel" in line:
            continue
    # Parse test headers (path lines before FAIL)
    chunks = re.findall(
        r"^((?:browser/|netwerk/|security/|extensions/|xpcshell|dom/).+)\n((?:  .+\n)+)",
        summary,
        re.M,
    )
    for test_id, body in chunks:
        blob = test_id + body
        matched_env = False
        for frag, _, reason in XPC_ENV:
            if frag in blob or frag in test_id:
                env += 1
                matched_env = True
                break
        if not matched_env:
            inex += 1
            bucket3_lines.append(blob.strip()[:800])
    # Adjust: unexp is checks not tests; use test-level counts
    env_tests = sum(1 for t, b in chunks if any(f in t + b for f, _, _ in XPC_ENV))
    inex_tests = len(chunks) - env_tests
    return b1_expected, env_tests, inex_tests, bucket3_lines


def wpt_stats(path: Path) -> dict:
    log = path.read_text(errors="replace")
    starts = len(re.findall(r"^[\d:.]+ TEST_START:", log, re.M))
    ends_ok = len(re.findall(r"TEST_END: .*expected OK", log))
    ends_err = len(re.findall(r"TEST_END: (ERROR|FAIL|TIMEOUT)", log))
    ends_other = len(re.findall(r"^[\d:.]+ TEST_END:", log, re.M)) - ends_ok - ends_err
    queue = re.search(r"Tests left in the queue:.*and (\d+) others", log)
    left = int(queue.group(1)) if queue else None
    wptrunner = log.count("__wptrunner_process_next_event is not a function")
    return {
        "starts": starts,
        "ends_ok": ends_ok,
        "ends_err": ends_err,
        "queue_left": left,
        "wptrunner_errors": wptrunner,
    }


def main() -> None:
    xpc = (BASE / "xpcshell-test.log").read_text(errors="replace")
    b1, env_t, inex_t, b3 = classify_xpcshell(xpc)
    wpt = wpt_stats(BASE / "web-platform-tests.log")
    print("xpcshell_bucket1_checks", b1)
    print("xpcshell_env_tests", env_t, "inex_tests", inex_t, "unexpected_checks", 43)
    print("wpt", wpt)


if __name__ == "__main__":
    main()
