"""Shared helpers for the data-fetch scripts."""
import json
import math
import ssl
import urllib.request

try:  # python.org framework builds don't see the system cert store
    import certifi

    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

M_PER_DEG_LAT = 111320.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(38.9))  # DC latitude


def fetch_geojson(url):
    with urllib.request.urlopen(url, timeout=180, context=SSL_CTX) as resp:
        return json.load(resp)


def simplify(points, epsilon_deg):
    """Iterative Douglas-Peucker on [lat, lon] points (epsilon in degrees)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        seg_len2 = dx * dx + dy * dy
        max_d2, max_i = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if seg_len2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len2))
                d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
            if d2 > max_d2:
                max_d2, max_i = d2, i
        if max_d2 > epsilon_deg * epsilon_deg:
            keep[max_i] = True
            stack.append((a, max_i))
            stack.append((max_i, b))
    return [p for p, k in zip(points, keep) if k]


def point_seg_dist_m(p, a, b):
    """Distance in meters from point p to segment a-b, all [lat, lon]."""
    py, px = p[0] * M_PER_DEG_LAT, p[1] * M_PER_DEG_LON
    ay, ax = a[0] * M_PER_DEG_LAT, a[1] * M_PER_DEG_LON
    by, bx = b[0] * M_PER_DEG_LAT, b[1] * M_PER_DEG_LON
    dx, dy = bx - ax, by - ay
    seg_len2 = dx * dx + dy * dy
    if seg_len2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def geom_paths(geometry):
    """Yield [[lat, lon], ...] paths from LineString/MultiLineString geometry."""
    if geometry["type"] == "LineString":
        yield [[c[1], c[0]] for c in geometry["coordinates"]]
    elif geometry["type"] == "MultiLineString":
        for part in geometry["coordinates"]:
            yield [[c[1], c[0]] for c in part]
    else:
        raise ValueError(f"unexpected geometry type {geometry['type']}")


def round_path(path, nd=6):
    return [[round(lat, nd), round(lon, nd)] for lat, lon in path]
