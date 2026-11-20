#!/usr/bin/env python3
"""Détecte les achats récurrents dans un export de commandes Amazon (JSON).

Usage : python3 scripts/analyze_recurring.py data/orders_marie.json
Entrée : liste de {date: "16 novembre 2026", total, id, items: [{t, a(ASIN)}]}
Sortie : data/recurring_marie.json + tableau console.
"""
import json, re, sys, statistics
from collections import defaultdict
from datetime import date
from pathlib import Path

MOIS = {m: i for i, m in enumerate(
    "janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split(), 1)}


def parse_date(s):
    m = re.match(r"(\d{1,2})\s+(\S+)\s+(\d{4})", s or "")
    if not m or m.group(2).lower() not in MOIS:
        return None
    return date(int(m.group(3)), MOIS[m.group(2).lower()], int(m.group(1)))


STOP = set("de du des la le les et en pour avec à a au aux x un une sans the and for with of".split())


def key_words(title):
    w = re.findall(r"[a-zà-ÿ0-9]+", title.lower())
    return [x for x in w if x not in STOP and len(x) > 2][:6]


def main(src):
    orders = json.loads(Path(src).read_text())
    by_key = defaultdict(list)  # regroupe par ASIN, puis par marque+mots-clés pour les ASIN changeants
    titles = {}
    for o in orders:
        d = parse_date(o.get("date"))
        if not d:
            continue
        for it in o.get("items", []):
            k = it.get("a") or it["t"][:40]
            by_key[k].append(d)
            titles[k] = it["t"]
    # fusion des ASIN différents d'un même produit (même 4 premiers mots-clés)
    merged = defaultdict(list)
    names = {}
    for k, ds in by_key.items():
        sig = " ".join(key_words(titles[k])[:4])
        merged[sig].extend(ds)
        names.setdefault(sig, titles[k])
    today = date.today()
    out = []
    for sig, ds in merged.items():
        ds = sorted(set(ds))
        if len(ds) < 3:
            continue
        gaps = [(b - a).days for a, b in zip(ds, ds[1:]) if (b - a).days >= 5]
        if len(gaps) < 2:
            continue
        med = statistics.median(gaps)
        recent = [g for g in gaps[-4:]]
        nxt = ds[-1].toordinal() + int(statistics.median(recent))
        out.append({
            "produit": names[sig][:110],
            "achats": len(ds),
            "premier": ds[0].isoformat(),
            "dernier": ds[-1].isoformat(),
            "intervalle_median_j": int(med),
            "intervalle_recent_j": int(statistics.median(recent)),
            "regularite": round(statistics.pstdev(gaps) / med, 2) if med else None,
            "prochain_estime": date.fromordinal(nxt).isoformat(),
            "actif": (today - ds[-1]).days < 3 * statistics.median(recent),
            "dates": [x.isoformat() for x in ds],
        })
    out.sort(key=lambda r: (not r["actif"], -r["achats"]))
    dst = Path(src).with_name(Path(src).name.replace("orders", "recurring"))
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    for r in out:
        print(f"{'●' if r['actif'] else '○'} {r['achats']:>3}x  /{r['intervalle_recent_j']:>4} j (méd {r['intervalle_median_j']:>4})  "
              f"dernier {r['dernier']} → {r['prochain_estime']}  {r['produit'][:70]}")
    print(f"\n{len(out)} produits récurrents → {dst}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/orders_marie.json")
