#!/usr/bin/env python3
"""Strip CRLF and pin HERE/REPO so a copy in /tmp still finds the repo."""
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
here = sys.argv[3]
repo = sys.argv[4]
t = src.read_text(encoding="utf-8").replace("\r", "")
t = t.replace('HERE="$(cd "$(dirname "$0")" && pwd)"', f'HERE="{here}"', 1)
t = t.replace(
    'HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    f'HERE="{here}"',
    1,
)
t = t.replace('REPO="$(cd "$HERE/../.." && pwd)"', f'REPO="{repo}"', 1)
t = t.replace(
    'REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel)"',
    f'REPO="{repo}"',
)
dst.write_text(t, encoding="utf-8")
print(f"wrote {dst}")
