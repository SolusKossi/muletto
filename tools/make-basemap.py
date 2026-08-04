"""Bake a world coastline into a self-contained SVG path.

The map view plots where the user has been. Fetching tiles from a map server
at runtime would send those coordinates to a third party, which is the one
thing this product promises not to do. So the basemap ships with the app.

Input is Natural Earth 1:110m land, via the world-atlas package. Natural Earth
is public domain, so there is no attribution requirement and no licence to
carry into a paid product; we credit it anyway in the generated file.

Output is apps/web/basemap.js: one SVG path string already projected to the
equirectangular 1000x500 viewBox the map uses, so the browser does no
projection work and there is no geometry library to load.

    python tools/make-basemap.py
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "vendor", "land-110m.json")
OUT = os.path.join(ROOT, "apps", "web", "basemap.js")

W, H = 1000.0, 500.0

# Coastline detail beyond this is invisible at 1000px wide and only costs bytes.
TOLERANCE = 0.06   # degrees
MIN_AREA = 0.35    # square degrees; drops specks that render as single pixels


def decode_arcs(topo):
    """TopoJSON arcs are quantised and delta-encoded; undo both."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        out.append(pts)
    return out


def ring_points(arcs, indices):
    """A ring is a list of arc indices; a negative index means run it backwards."""
    pts = []
    for idx in indices:
        arc = arcs[~idx][::-1] if idx < 0 else arcs[idx]
        pts.extend(arc[1:] if pts else arc)
    return pts


def perpendicular_distance(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return ((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2) ** 0.5


def simplify(pts, tol):
    """Douglas-Peucker, iterative so a long coastline cannot blow the stack."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        lo, hi = stack.pop()
        worst, at = 0.0, -1
        for i in range(lo + 1, hi):
            d = perpendicular_distance(pts[i], pts[lo], pts[hi])
            if d > worst:
                worst, at = d, i
        if at != -1 and worst > tol:
            keep[at] = True
            stack.append((lo, at))
            stack.append((at, hi))
    return [p for p, k in zip(pts, keep) if k]


def area(pts):
    """Shoelace; sign ignored because we only want to drop tiny shapes."""
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def project(lon, lat):
    return ((lon + 180.0) / 360.0 * W, (90.0 - lat) / 180.0 * H)


def split_at_antimeridian(pts):
    """Cut a ring wherever it jumps the date line.

    Russia reaches past 180 degrees, so its ring steps straight from one edge
    of an equirectangular map to the other. Drawn as one polygon that step
    becomes a band of land across the whole world. Each side of the cut is a
    separate shape here, which is what the projection actually means.
    """
    pieces, cur = [], []
    for i, p in enumerate(pts):
        if cur and abs(p[0] - cur[-1][0]) > 180.0:
            pieces.append(cur)
            cur = []
        cur.append(p)
    if cur:
        pieces.append(cur)
    if len(pieces) > 1 and pieces[0] and pieces[-1]:
        # The ring is closed, so its first and last pieces are one shape unless
        # the wrap happens to fall exactly on the join.
        if abs(pieces[0][0][0] - pieces[-1][-1][0]) <= 180.0:
            pieces[0] = pieces[-1] + pieces[0]
            pieces.pop()
    return pieces


def main():
    topo = json.load(open(SRC, encoding="utf-8"))
    arcs = decode_arcs(topo)
    land = topo["objects"]["land"]

    polygons = []
    geoms = land["geometries"] if land["type"] == "GeometryCollection" else [land]
    for g in geoms:
        if g["type"] == "Polygon":
            polygons.append(g["arcs"])
        elif g["type"] == "MultiPolygon":
            polygons.extend(g["arcs"])

    rings, kept, dropped, split = [], 0, 0, 0
    for poly in polygons:
        for ring in poly:
            pts = ring_points(arcs, ring)
            pieces = split_at_antimeridian(pts)
            if len(pieces) > 1:
                split += 1
            for piece in pieces:
                if len(piece) < 3 or area(piece) < MIN_AREA:
                    dropped += 1
                    continue
                piece = simplify(piece, TOLERANCE)
                if len(piece) >= 3:
                    rings.append(piece)
                    kept += 1

    parts = []
    for pts in rings:
        d = []
        for i, (lon, lat) in enumerate(pts):
            x, y = project(lon, lat)
            d.append(("M" if i == 0 else "L") + f"{x:.1f} {y:.1f}")
        parts.append("".join(d) + "Z")
    path = "".join(parts)

    body = (
        "/* Generated by tools/make-basemap.py - do not edit.\n"
        "\n"
        "   World coastline from Natural Earth 1:110m land, which is public domain.\n"
        "   Baked into an SVG path already projected to the equirectangular\n"
        "   1000x500 viewBox the map view uses, so nothing is fetched at runtime and\n"
        "   no projection or geometry library is needed. Plotting where someone has\n"
        "   been must not involve asking a map server for anything. */\n"
        "window.MBasemap = {\n"
        "  width: %d, height: %d,\n"
        "  source: \"Natural Earth 1:110m land (public domain)\",\n"
        "  path: \"%s\",\n"
        "};\n" % (int(W), int(H), path)
    )
    open(OUT, "w", newline="\n", encoding="ascii").write(body)

    total = sum(len(r) for r in rings)
    print("rings kept   %d  (dropped %d below %.2f sq deg, %d rings split at the date line)"
          % (kept, dropped, MIN_AREA, split))
    print("points       %d after simplification at %.2f deg" % (total, TOLERANCE))
    print("written      %s  %.0f KB" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
