#!/usr/bin/env node
/* Achats récurrents Amazon — automatisation quotidienne (launchd).
 *   morning : vérifie stock/prix, prévient Marie des commandes du jour (avec lien de l'app) et des ruptures à venir.
 *   order   : commande les articles du jour ENCORE COCHÉS, référence exacte (ASIN), puis décale la prochaine date.
 * Options : --dry-run (aucun achat, messages affichés en console), --date=AAAA-MM-JJ (simulation).
 */
const amz = require("../lib/amazon"), st = require("../lib/state"), notify = require("../lib/notify");
const { execFileSync } = require("child_process");
const APP_CODE = (() => { try { return execFileSync("/Users/thomaslefevre/.t3/bin/t3-vault", ["get", "achats-recurrents-app", "--field", "password"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
const APP_URL = "https://mrthomaslef.github.io/achats-recurrents/" + (APP_CODE ? "#k=" + APP_CODE : "");
const mode = process.argv[2];
const DRY = process.argv.includes("--dry-run");
if (DRY) process.env.AMZ_DRY_NOTIFY = "1";
const today = (process.argv.find(a => a.startsWith("--date=")) || "").slice(7) || new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const eur = (n) => (n == null ? "?" : n.toFixed(2).replace(".", ",") + " €");
const name = (it) => it.short || it.title.slice(0, 45);
const isDue = (it) => it.next <= today;

async function withBrowser(fn) {
  const { ctx, page } = await amz.open();
  try {
    const l = await amz.login(page);
    if (l !== "ok") {
      notify.thomas(`⚠️ Achats récurrents Amazon : connexion au compte de Marie impossible (${l}). Lancer : node ~/.t3/projects/amazon/scripts/login.js --show`);
      throw new Error("login " + l);
    }
    return await fn(page);
  } finally { await ctx.close(); }
}

async function morning() {
  const { state } = await st.load();
  // Vérifie aujourd'hui + les 3 prochains jours (pour prévenir des ruptures à l'avance)
  const watch = state.items.filter(it => it.checked && it.next <= addDays(today, 3));
  const checks = await withBrowser(async (page) => {
    const out = {};
    for (const it of watch) out[it.asin] = await amz.check(page, it.asin).catch(e => ({ error: String(e) }));
    return out;
  });
  const due = [], rupture = [], soon = [];
  const save = DRY ? async (m) => m(state) : st.update; // simulation : aucune écriture
  await save((s) => {
    for (const it of s.items) {
      const c = checks[it.asin];
      if (!c || c.error) continue;
      it.price = c.price ?? it.price; it.image = c.image || it.image; it.availability = c.availability; it.checkedAt = new Date().toISOString();
      it.status = c.available && c.exact ? "ok" : "rupture";
      if (!it.checked) continue;
      if (isDue(it)) (it.status === "ok" ? due : rupture).push(it);
      else if (it.status === "rupture" && it.ruptureNotified !== it.next) { soon.push(it); it.ruptureNotified = it.next; }
    }
    // « notified » n'est rempli qu'APRÈS l'envoi réel du message à Marie (sinon pas de commande à 12h).
    s.today = { date: today, at: new Date().toISOString(), notified: [], pending: due.map(i => i.asin), rupture: rupture.map(i => i.asin) };
  }, `matin ${today}`);

  const lines = [];
  if (due.length) {
    const total = due.reduce((t, i) => t + (i.price || 0) * (i.qty || 1), 0);
    lines.push(`Bonjour Marie 🛒 Commande Amazon automatique aujourd'hui à 12h :`);
    for (const i of due) lines.push(`• ${name(i)}${i.qty > 1 ? " ×" + i.qty : ""} — ${eur(i.price)}`);
    lines.push(`Total estimé : ${eur(total)}`);
  }
  if (rupture.length) {
    lines.push("", `⚠️ En rupture, pas commandé (je réessaie chaque jour) :`);
    for (const i of rupture) lines.push(`• ${name(i)} — ${i.availability || "indisponible"}`);
  }
  if (soon.length) {
    lines.push("", `⚠️ Rupture à venir (commande prévue bientôt) :`);
    for (const i of soon) lines.push(`• ${name(i)} — prévu le ${i.next.split("-").reverse().join("/")}`);
  }
  if (!lines.length) return console.log(today, "rien à signaler");
  lines.push("", due.length ? `Pour annuler un article, décoche-le avant 12h : ${APP_URL}` : `Gérer les achats : ${APP_URL}`);
  try { notify.marie(lines.join("\n")); }
  catch (e) {
    notify.thomas(`⚠️ Achats récurrents Amazon : le message du matin n'a pas pu être envoyé à Marie → pas de commande aujourd'hui (${due.map(name).join(", ") || "rien de prévu"}). ${String(e).slice(0, 120)}`);
    throw e;
  }
  if (due.length && !DRY) await st.update((s) => { if (s.today?.date === today) { s.today.notified = s.today.pending || []; s.today.at = new Date().toISOString(); } }, `Marie prévenue ${today}`);
  if (rupture.length || soon.length) notify.thomas("Achats récurrents Amazon — rupture : " + [...rupture, ...soon].map(name).join(", "));
}

async function order() {
  const { state } = await st.load();
  const due = state.items.filter(it => it.checked && isDue(it));
  // Sécurité : jamais de commande si Marie n'a pas été prévenue ce matin.
  // …et au moins 90 min de délai pour qu'elle puisse décocher (Mac en veille à 8h → message tardif → commande reportée à demain).
  const t = state.today || {};
  const delayOk = t.at && Date.now() - Date.parse(t.at) >= 90 * 60 * 1000;
  const notified = new Set(t.date === today && delayOk ? t.notified : []);
  const toBuy = DRY ? due : due.filter(it => notified.has(it.asin));
  if (!toBuy.length) return console.log(today, "rien à commander");
  const results = await withBrowser(async (page) => {
    const out = [];
    for (const it of toBuy) {
      const ref = it.price || null;
      const maxPrice = ref ? Math.max(ref * 1.4, ref + 5) : 80;
      const r = await amz.buy(page, it.asin, it.qty || 1, { dryRun: DRY, maxPrice }).catch(e => ({ ok: false, reason: String(e) }));
      out.push({ it, r }); console.log(it.asin, JSON.stringify({ ok: r.ok, total: r.total, orderId: r.orderId, reason: r.reason }));
    }
    return out;
  });
  const ok = results.filter(x => x.r.ok), ko = results.filter(x => !x.r.ok);
  if (!DRY) await st.update((s) => {
    s.log = s.log || [];
    for (const { it, r } of results) {
      const x = s.items.find(i => i.asin === it.asin); if (!x) continue;
      if (r.ok) {
        x.last = today; x.next = addDays(today, x.interval); x.count = (x.count || 0) + 1; x.status = "ok"; delete x.ruptureNotified;
        s.log.unshift({ date: today, asin: x.asin, title: name(x), qty: x.qty || 1, total: r.total, orderId: r.orderId });
      } else {
        x.status = r.retry ? "ok" : /rupture|indisponible/i.test(r.reason) ? "rupture" : "erreur"; x.lastError = r.reason;
      }
    }
    s.log = s.log.slice(0, 200);
  }, `commandes ${today}`);
  const msg = [];
  if (ok.length) { msg.push(`✅ Commandé sur Amazon :`); ok.forEach(({ it, r }) => msg.push(`• ${name(it)} — ${eur(r.total)}`)); }
  if (ko.length) { msg.push(ok.length ? "" : "", `⚠️ Pas commandé :`); ko.forEach(({ it, r }) => msg.push(`• ${name(it)} — ${r.reason}`)); }
  notify.marie(msg.join("\n").trim());
  if (ko.length) notify.thomas("Achats récurrents Amazon — échec : " + ko.map(({ it, r }) => `${name(it)} (${r.reason})`).join(" ; "));
}

(async () => {
  try {
    if (mode === "morning") await morning();
    else if (mode === "order") await order();
    else { console.log("usage: runner.js morning|order [--dry-run] [--date=AAAA-MM-JJ]"); process.exit(1); }
  } catch (e) {
    console.error(e);
    if (!DRY && !/^Error: (login|iMessage non envoyé à \+)/.test(String(e))) notify.thomas("⚠️ Achats récurrents Amazon (" + mode + ") : " + String(e).slice(0, 200));
    process.exit(1);
  }
})();
