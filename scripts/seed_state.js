// Ajoute les articles de data/items.json à l'état GitHub (sans écraser les réglages de Marie).
const fs = require("fs"), path = require("path"), st = require("../lib/state");
const SHORT = {
  B086DST1XY: "Kérastase Blond Absolu — shampoing", B07KQQF6DZ: "Kérastase Blond Absolu — Cicaflash",
  B08483TFWK: "Lait croissance Babybio 6×25 cl", B0BLW6DCM1: "Pampers Baby-Dry Pants T5 ×160",
  B008JEI92A: "Carnet Clairefontaine Zap Book", B0BLXN5JDH: "SVR Topialyse crème 200 ml",
  B0D6TXMFRP: "Patchs anti-boutons ×350", B0DH55WZ7X: "Lingettes Mixa Bébé 18×48",
  B0CWRWMXN5: "Harpic gel WC javel", B09K7WBNKP: "Huile lavante Cadum bébé",
  B082VVLKTG: "Vanish détachant pistolet", B0CQP8J8QC: "Erborian Super BB Concealer",
  B0CRL656TK: "Stick anti-crevasses Scholl", B0C6R5TD9D: "Déodorant Dove Advanced Care",
  B083TX6VBG: "Erborian CC Dull Correct", B0CB6TBT3Y: "Masque Wella Invigo Nutri-Enrich",
  B008MT0CVS: "Déboucheur Ouragan gel 1 L", B0DHSS4ZW3: "Eau de toilette Biolane bébé", B0DG2MT3K2: "Dentifrice Oral-B 3D White Arctic Fresh ×3",
};
(async () => {
  const items = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/items.json"), "utf8"));
  const minNext = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10); // jamais de commande sans préavis
  const { state } = await st.update((s) => {
    s.items = s.items || []; s.log = s.log || [];
    const by = Object.fromEntries(s.items.map(i => [i.asin, i]));
    for (const it of items) {
      const { history, ...rest } = it;
      if (by[it.asin]) { by[it.asin].short = by[it.asin].short || SHORT[it.asin]; by[it.asin].history = history; continue; }
      s.items.push({ ...rest, history, short: SHORT[it.asin], next: it.next < minNext ? minNext : it.next, price: null, image: null, status: "ok" });
    }
    for (const i of s.items) { i.short = i.short || SHORT[i.asin]; i.history = i.history || (items.find(x => x.asin === i.asin) || {}).history || []; }
  }, "articles récurrents (historique)");
  console.log(state.items.length, "articles", state.items.filter(i => !i.short).length, "sans nom court");
})();
