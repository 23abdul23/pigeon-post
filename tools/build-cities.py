"""Builds src/data/cities.json from GeoNames cities15000 (pop >= 50k).
Run: python -X utf8 tools/build-cities.py (needs tools/cities15000.zip)."""
import json, zipfile, pathlib

root = pathlib.Path(__file__).parent
rows = []
with zipfile.ZipFile(root / "cities15000.zip") as z:
    with z.open("cities15000.txt") as f:
        for line in f.read().decode("utf-8").splitlines():
            c = line.split("\t")
            pop = int(c[14] or 0)
            if pop >= 50000:
                rows.append([c[2], c[8], round(float(c[4]), 2), round(float(c[5]), 2), pop])
rows.sort(key=lambda r: -r[4])
out = root.parent / "src" / "data" / "cities.json"
out.write_text(json.dumps(rows, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
print(len(rows), "cities", out.stat().st_size // 1024, "KB")
