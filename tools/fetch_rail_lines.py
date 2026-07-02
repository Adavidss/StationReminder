#!/usr/bin/env python3
"""One-time generator for js/rail_lines.js — WMATA rail line polylines.

Source: Open Data DC "Metro Lines Regional" (public, no API key).
"""
import json
import sys
from datetime import date
from pathlib import Path

from geo_common import fetch_geojson, geom_paths, round_path, simplify

SOURCE_URL = (
    "https://opendata.dc.gov/api/download/v1/items/"
    "ead6291a71874bf8ba332d135036fbda/geojson?layers=58"
)
EXPECTED_LINES = {"red", "orange", "silver", "blue", "yellow", "green"}
EPSILON_DEG = 0.00012  # ~13 m — visually smooth at city zooms
OUT_PATH = Path(__file__).resolve().parent.parent / "js" / "rail_lines.js"


def main():
    print(f"Fetching {SOURCE_URL}")
    data = fetch_geojson(SOURCE_URL)
    lines = {}
    for f in data.get("features", []):
        name = (f["properties"].get("NAME") or "").strip().lower()
        if name not in EXPECTED_LINES:
            print(f"ERROR: unexpected line name {name!r}", file=sys.stderr)
            sys.exit(1)
        paths = [round_path(simplify(p, EPSILON_DEG)) for p in geom_paths(f["geometry"])]
        lines.setdefault(name, []).extend(paths)

    missing = EXPECTED_LINES - set(lines)
    if missing:
        print(f"ERROR: missing lines {missing}", file=sys.stderr)
        sys.exit(1)

    total_pts = sum(len(p) for paths in lines.values() for p in paths)
    body = json.dumps(lines, separators=(",", ":"))
    OUT_PATH.write_text(
        f"// Generated {date.today().isoformat()} by tools/fetch_rail_lines.py\n"
        f"// Source: Open Data DC \"Metro Lines Regional\" "
        f"(simplified, {total_pts} points)\n"
        f"// {SOURCE_URL}\n"
        f"const RAIL_LINES = {body};\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT_PATH} ({total_pts} points, {OUT_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
