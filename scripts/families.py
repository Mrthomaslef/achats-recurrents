#!/usr/bin/env python3
"""Regroupe les achats par « besoin » (famille de produits) et calcule les intervalles."""
import json, re, statistics, sys
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from analyze_recurring import parse_date

FAM = {
 "Couches-culottes Pampers/Lillydoo (T5)": r"pampers|lillydoo|couches",
 "Lait de croissance (Babybio/Blédilait/Gallia)": r"lait.*croissance|croissance.*lait|bl[ée]dilait|calisma|babybio croissance",
 "Lingettes bébé (Mixa/Biolane/Cadum)": r"lingettes? b[ée]b[ée]|mixa.*lingette|biolane.*lingette|lingettes.*eau",
 "Kérastase Blond Absolu (shampoing/soin)": r"k[ée]rastase",
 "Déodorant Dove": r"dove.*d[ée]odorant|d[ée]odorant.*dove",
 "SVR Topialyse crème": r"topialyse",
 "Erborian (BB/CC/anticernes/Ginseng)": r"erborian",
 "Toilette bébé (gel/huile/eau de toilette Biolane/Mixa/Cadum)": r"(biolane|mixa b[ée]b[ée]|cadum).*(gel|huile|eau de toilette|douche)",
 "Papier toilette": r"papier toilette",
 "Gel WC / déboucheur": r"gel wc|d[ée]boucheur|destop|ouragan",
 "Sacs poubelle": r"sacs? poubelle",
 "Carnets Clairefontaine Zap Book": r"zap book",
 "Brosse à dents / dentifrice": r"brosse [àa] dents|dentifrice",
 "Lessive / détachant": r"lessive|vanish|d[ée]tachant",
 "Lave-vaisselle / liquide vaisselle": r"lave-vaisselle|vaisselle",
 "Olaplex / Wella / soins cheveux": r"olaplex|wella|l'or[ée]al professionnel|masque.*cheveux",
 "Patchs boutons": r"pimple|patch bouton",
 "Courses Monoprix (panier complet)": None,
}

def main(src="data/orders_marie.json"):
    orders = json.loads(Path(src).read_text())
    hits = {k: [] for k in FAM}
    for o in orders:
        d = parse_date(o["date"])
        if o["mono"]:
            hits["Courses Monoprix (panier complet)"].append((d, o["total"]))
            continue
        for k, rx in FAM.items():
            if rx and any(re.search(rx, i["t"], re.I) for i in o["items"]):
                hits[k].append((d, o["total"]))
    today = date(2026, 11, 20)
    res = []
    for k, lst in hits.items():
        ds = sorted({d for d, _ in lst})
        if len(ds) < 3:
            continue
        gaps = [(b - a).days for a, b in zip(ds, ds[1:]) if (b - a).days >= 4]
        rec = [g for g, d in zip(gaps, ds[1:]) if (today - d).days <= 365] or gaps
        iv = int(statistics.median(rec))
        res.append(dict(besoin=k, achats=len(ds), achats_12m=sum((today - d).days <= 365 for d in ds),
                        premier=ds[0].isoformat(), dernier=ds[-1].isoformat(), intervalle_j=iv,
                        mini=min(rec), maxi=max(rec),
                        prochain=date.fromordinal(ds[-1].toordinal() + iv).isoformat(),
                        actif=(today - ds[-1]).days <= max(2 * iv, 60)))
    res.sort(key=lambda r: (not r["actif"], -r["achats_12m"]))
    Path("data/families_marie.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    for r in res:
        print(f"{'●' if r['actif'] else '○'} {r['besoin'][:48]:48} {r['achats']:>3}x ({r['achats_12m']:>2} sur 12 mois)  tous les {r['intervalle_j']:>3} j [{r['mini']}-{r['maxi']}]  dernier {r['dernier']} → {r['prochain']}")

main(*sys.argv[1:])
