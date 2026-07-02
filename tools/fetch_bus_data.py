#!/usr/bin/env python3
"""One-time generator for data/bus.json — WMATA bus routes + stops.

Sources (Open Data DC, public, no API key):
- "Metro Bus Stops"  — 8k+ stop points (current network; no route field)
- "Metro Bus Routes" — per-direction route polylines (current designators)

The stops layer carries no route associations, so this script derives them
spatially: a stop serves a route if it lies within JOIN_DIST_M of any of the
route's (full-resolution) polylines. Shipped polylines are simplified.

Output format (compact, lazy-loaded by the app):
{
  "routes": [ {"id": "A70", "desc": "Glebe Rd", "via": "Potomac Yard ↔ Tysons Corner Ctr",
               "paths": [[[lat, lon], ...], ...]}, ... ],           # sorted by id
  "stops":  [ [regId, "Brinkley Rd+Trude St", lat, lon, [routeIdx, ...]], ... ]
}
"""
import json
import math
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

from geo_common import (
    M_PER_DEG_LAT,
    fetch_geojson,
    geom_paths,
    point_seg_dist_m,
    round_path,
    simplify,
)

STOPS_URL = (
    "https://opendata.dc.gov/api/download/v1/items/"
    "e85b5321a5a84ff9af56fd614dab81b3/geojson?layers=53"
)
ROUTES_URL = (
    "https://opendata.dc.gov/api/download/v1/items/"
    "35738eb6405f4bb0bfdceddb21ac3122/geojson?layers=59"
)
JOIN_DIST_M = 30.0
EPSILON_SHIP_DEG = 0.00025  # ~28 m — shipped polyline simplification
GRID_DEG = 0.004  # ~440 m spatial-index cell
LAT_RANGE = (38.3, 39.5)
LON_RANGE = (-78.0, -76.2)
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "bus.json"


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def clean_place(s):
    """'King St-Old Town+Bay A' -> 'King St-Old Town'."""
    return re.sub(r"\+.*$", "", (s or "").strip())


def main():
    print(f"Fetching routes: {ROUTES_URL}")
    routes_raw = fetch_geojson(ROUTES_URL)
    print(f"Fetching stops: {STOPS_URL}")
    stops_raw = fetch_geojson(STOPS_URL)

    # ---- group route records (per direction) by route designator ----
    by_route = defaultdict(lambda: {"desc": "", "via": "", "full": [], "ship": []})
    for f in routes_raw.get("features", []):
        p = f["properties"]
        rid = (p.get("ROUTE") or "").strip()
        if not rid:
            continue
        r = by_route[rid]
        if not r["desc"]:
            r["desc"] = (p.get("DESCRIPTION") or "").strip()
            o, d = clean_place(p.get("ORIGIN")), clean_place(p.get("DESTINATION"))
            if o and d:
                r["via"] = f"{o} ↔ {d}"
        for path in geom_paths(f["geometry"]):
            r["full"].append(path)
            r["ship"].append(round_path(simplify(path, EPSILON_SHIP_DEG)))

    route_ids = sorted(by_route)
    if not (100 <= len(route_ids) <= 200):
        fail(f"suspicious route count {len(route_ids)} (expected ~128)")

    # ---- spatial index: grid cell -> [(route_idx, seg_a, seg_b)] ----
    grid = defaultdict(list)
    for ri, rid in enumerate(route_ids):
        for path in by_route[rid]["full"]:
            for a, b in zip(path, path[1:]):
                min_r = min(a[0], b[0]) - 0.0005
                max_r = max(a[0], b[0]) + 0.0005
                min_c = min(a[1], b[1]) - 0.0005
                max_c = max(a[1], b[1]) + 0.0005
                r0, r1 = int(min_r / GRID_DEG), int(max_r / GRID_DEG)
                c0, c1 = int(min_c / GRID_DEG), int(max_c / GRID_DEG)
                for rr in range(r0, r1 + 1):
                    for cc in range(c0, c1 + 1):
                        grid[(rr, cc)].append((ri, a, b))

    # ---- stops + join ----
    stops = []
    seen_ids = set()
    no_route = 0
    for f in stops_raw.get("features", []):
        p = f["properties"]
        reg_id = p.get("REG_ID")
        name = (p.get("BSTP_MSG_TEXT") or "").strip()
        lon, lat = f["geometry"]["coordinates"][:2]
        if reg_id is None or not name:
            continue
        if reg_id in seen_ids:
            continue
        seen_ids.add(reg_id)
        if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]) or not (LON_RANGE[0] <= lon <= LON_RANGE[1]):
            fail(f"stop {reg_id} outside region: {lat}, {lon}")

        cell = (int(lat / GRID_DEG), int(lon / GRID_DEG))
        best = {}
        for rr in range(cell[0] - 1, cell[0] + 2):
            for cc in range(cell[1] - 1, cell[1] + 2):
                for ri, a, b in grid.get((rr, cc), ()):
                    d = point_seg_dist_m([lat, lon], a, b)
                    if d <= JOIN_DIST_M and d < best.get(ri, math.inf):
                        best[ri] = d
        if not best:
            no_route += 1
        stops.append([reg_id, name, round(lat, 6), round(lon, 6), sorted(best)])

    if len(stops) < 7000:
        fail(f"suspiciously few stops: {len(stops)}")
    stops.sort(key=lambda s: s[1].lower())

    out = {
        "generated": date.today().isoformat(),
        "routes": [
            {
                "id": rid,
                "desc": by_route[rid]["desc"],
                "via": by_route[rid]["via"],
                "paths": by_route[rid]["ship"],
            }
            for rid in route_ids
        ],
        "stops": stops,
    }
    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kb = OUT_PATH.stat().st_size // 1024
    print(
        f"Wrote {OUT_PATH}: {len(route_ids)} routes, {len(stops)} stops "
        f"({no_route} with no current route), {kb} KB"
    )


if __name__ == "__main__":
    main()
