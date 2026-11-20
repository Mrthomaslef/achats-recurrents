#!/usr/bin/env python3
"""Construit data/items.json : références EXACTES (ASIN) achetées régulièrement, avec intervalle et prochaine date."""
import json, statistics, sys
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from analyze_recurring import parse_date

TODAY = date.today()
EXCLUDE = {"B0HJCYTGCV"}  # objets ponctuels éventuels
# Besoins couverts par plusieurs références interchangeables : intervalle du besoin, pas de la référence
INTERVAL_OVERRIDE = {"B0BLW6DCM1": 30}  # Pampers Baby-Dry Pants T5 x160 « Pack 1 mois » (famille couches : ~29 j)

def main():
    orders = json.loads(Path("data/orders_marie.json").read_text())
    m = {}
    for o in orders:
        if o["mono"]:
            continue  # courses Monoprix : créneaux de livraison, hors automatisation
        d = parse_date(o["date"])
        for i in o["items"]:
            if i.get("a"):
                e = m.setdefault(i["a"], {"t": i["t"], "d": set()})
                e["d"].add(d)
    items = []
    for asin, e in m.items():
        ds = sorted(e["d"])
        if asin in EXCLUDE or len(ds) < 3 or (TODAY - ds[-1]).days > 365:
            continue
        gaps = [(b - a).days for a, b in zip(ds, ds[1:]) if (b - a).days >= 5]
        if len(gaps) < 2:
            continue
        iv = INTERVAL_OVERRIDE.get(asin) or int(statistics.median(gaps[-5:]))
        if (TODAY - ds[-1]).days > max(2.5 * iv, 45):
            continue  # référence abandonnée / remplacée
        nxt = ds[-1] + timedelta(days=iv)
        while nxt <= TODAY:
            nxt += timedelta(days=iv)
        items.append({
            "asin": asin, "title": e["t"], "qty": 1, "interval": iv,
            "last": ds[-1].isoformat(), "next": nxt.isoformat(), "count": len(ds),
            "history": [x.isoformat() for x in ds], "checked": True,
            "url": f"https://www.amazon.fr/dp/{asin}",
        })
    items.sort(key=lambda x: x["next"])
    Path("data/items.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))
    for x in items:
        print(f"{x['next']}  /{x['interval']:>3}j  {x['count']:>2}x  {x['asin']}  {x['title'][:70]}")
    print(len(items), "articles")

main()
