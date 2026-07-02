#!/usr/bin/env python3
"""One-time generator for js/stations.js.

Fetches the Open Data DC "Metro Stations Regional" GeoJSON (public, no API key;
covers all WMATA Metrorail stations in DC/MD/VA) and emits a static JS array.
Re-run only if WMATA opens or renames a station.
"""
import json
import ssl
import sys
import urllib.request
from datetime import date
from pathlib import Path

try:  # python.org framework builds don't see the system cert store
    import certifi

    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

SOURCE_URL = (
    "https://opendata.dc.gov/api/download/v1/items/"
    "e3896b58a4e741d48ddcda03dae9d21b/geojson?layers=51"
)
EXPECTED_COUNT = 98
# Regional bounding box: WMATA system spans Ashburn VA to Glenmont/Greenbelt MD
LAT_RANGE = (38.5, 39.2)
LON_RANGE = (-77.7, -76.6)
OUT_PATH = Path(__file__).resolve().parent.parent / "js" / "stations.js"


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    print(f"Fetching {SOURCE_URL}")
    with urllib.request.urlopen(SOURCE_URL, timeout=60, context=SSL_CTX) as resp:
        data = json.load(resp)

    features = data.get("features", [])
    if len(features) != EXPECTED_COUNT:
        fail(f"expected {EXPECTED_COUNT} stations, got {len(features)}")

    stations = []
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        name = (props.get("NAME") or "").strip()
        address = (props.get("ADDRESS") or "").strip()
        line_raw = (props.get("LINE") or "").strip()
        if geom.get("type") != "Point":
            fail(f"non-point geometry for {name!r}")
        lon, lat = geom["coordinates"][:2]  # GeoJSON order is [lon, lat]
        lines = [s.strip().lower() for s in line_raw.split(",") if s.strip()]

        if not name:
            fail("station with empty NAME")
        if not lines:
            fail(f"{name}: no lines")
        if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            fail(f"{name}: lat {lat} outside {LAT_RANGE}")
        if not (LON_RANGE[0] <= lon <= LON_RANGE[1]):
            fail(f"{name}: lon {lon} outside {LON_RANGE}")

        stations.append(
            {
                "name": name,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "lines": lines,
                "address": address,
            }
        )

    names = [s["name"] for s in stations]
    if len(set(names)) != len(names):
        fail("duplicate station names")

    stations.sort(key=lambda s: s["name"].lower())

    entries = ",\n".join(
        "  " + json.dumps(s, ensure_ascii=False, separators=(", ", ": "))
        for s in stations
    )
    OUT_PATH.write_text(
        f"// Generated {date.today().isoformat()} by tools/fetch_stations.py\n"
        f"// Source: Open Data DC \"Metro Stations Regional\" "
        f"({len(stations)} stations, DC/MD/VA)\n"
        f"// {SOURCE_URL}\n"
        f"const STATIONS = [\n{entries}\n];\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT_PATH} ({len(stations)} stations)")


if __name__ == "__main__":
    main()
