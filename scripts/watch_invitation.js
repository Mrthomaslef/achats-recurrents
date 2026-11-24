// Surveille l'invitation Amazon (compte de Marie) pour l'ETB Pokémon 30ᵉ anniversaire.
// Ne commande JAMAIS : prévient Marie et Thomas par iMessage, une seule fois, dès que l'achat est possible.
// Usage : node scripts/watch_invitation.js [--dry]   (--dry : affiche sans envoyer d'iMessage)
const fs = require("fs"), path = require("path");
const amz = require("../lib/amazon");
const notify = require("../lib/notify");

const ASIN = "B0H8SVJL9F"; // fiche officielle vendue par Amazon (55,99 €)
const URL = `https://www.amazon.fr/dp/${ASIN}`;
const STATE = path.join(__dirname, "..", "data", "etb-invitation.json");
if (process.argv.includes("--dry")) process.env.AMZ_DRY_NOTIFY = "1";

const load = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } };
const save = (s) => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); };
const both = (t) => { for (const f of [notify.marie, notify.thomas]) { try { f(t); } catch (e) { console.error(e.message); } } };

(async () => {
  const st = load();
  const now = new Date().toISOString();
  let ctx, page;
  try { ({ ctx, page } = await amz.open({ headless: true })); }
  catch (e) { console.error(now, "navigateur occupé/indisponible :", e.message.slice(0, 150)); process.exit(0); }
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const account = await page.locator("#nav-link-accountList").innerText().catch(() => "");
    if (!/Marie/i.test(account)) {
      console.log(now, "compte de Marie déconnecté :", account.replace(/\s+/g, " "));
      if (!st.loggedOutWarned) { notify.thomas("⚠️ Surveillance invitation ETB Pokémon : le compte Amazon de Marie est déconnecté sur le Mac, la vérification est en pause."); st.loggedOutWarned = now; }
      return;
    }
    st.loggedOutWarned = null;
    const box = await page.locator("#desktop_buybox, #buybox, #rightCol").first().innerText().catch(() => "");
    const pending = /Invitation demandée/i.test(box);
    const requestable = /Demander une invitation/i.test(box);
    const buyable = !pending && !requestable &&
      (await page.locator("#buy-now-button, #add-to-cart-button").first().isVisible().catch(() => false));
    const status = buyable ? "invitee" : pending ? "en_attente" : requestable ? "a_redemander" : "inconnu";
    console.log(now, "statut :", status);
    st.lastCheck = now; st.status = status;

    if (buyable && !st.invitedNotified) {
      both(`🎉 Invitation Amazon reçue pour l'ETB Pokémon 30ᵉ anniversaire (55,99 €) sur le compte de Marie !\nÀ commander vite (lien valable 72 h) : ${URL}\n(Vérifie aussi l'e-mail d'Amazon sur la boîte Gmail de Marie.)`);
      st.invitedNotified = now;
    }
    if (requestable && !st.requestableNotified) {
      notify.thomas(`ℹ️ ETB Pokémon 30 ans : la demande d'invitation n'apparaît plus sur le compte de Marie (invitation expirée ou refusée ?). On peut la redemander ici : ${URL}`);
      st.requestableNotified = now;
    }
  } finally {
    save(st);
    await ctx.close();
  }
})().catch((e) => { console.error(new Date().toISOString(), "erreur :", e.message); process.exit(1); });
