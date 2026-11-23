// Navigateur Amazon automatisé (profil persistant connecté au compte de Marie).
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const path = require("path"), os = require("os");

const PROFILE = path.join(os.homedir(), ".t3/private/amazon-marie-profile");
const VAULT = "/Users/thomaslefevre/.t3/bin/t3-vault";
const vault = (field) => execFileSync(VAULT, ["get", "amazon.com-marie", "--field", field], { encoding: "utf8" }).trim();

async function open({ headless = true } = {}) {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless, locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

async function isLoggedIn(page) {
  await page.goto("https://www.amazon.fr/gp/css/order-history?language=fr_FR", { waitUntil: "domcontentloaded" });
  return !/\/ap\/signin|\/ax\/claim/.test(page.url());
}

/** Connexion avec les identifiants du trousseau. Renvoie "ok" | "otp" | "captcha" | "error:<msg>". */
async function login(page) {
  if (await isLoggedIn(page)) return "ok";
  const email = page.locator("#ap_email_login, #ap_email, input[name=email]").first();
  if (await email.isVisible().catch(() => false)) {
    await email.fill(vault("user"));
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded");
  }
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 15000 }).catch(() => {});
  if (!(await pw.isVisible().catch(() => false))) return "error:pas de champ mot de passe (" + page.url() + ")";
  await pw.fill(vault("password"));
  await page.keyboard.press("Enter");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (/code de vérification|saisissez le code|one time password|otp|verification code/.test(body)) return "otp";
  if (/captcha|caractères que vous voyez|solve this puzzle/.test(body)) return "captcha";
  return (await isLoggedIn(page)) ? "ok" : "error:connexion refusée (" + page.url() + ")";
}

const PRICE_SEL = ["#corePrice_feature_div .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-offscreen", "#apex_desktop .a-price .a-offscreen", "#price_inside_buybox", "#tp_price_block_total_price_ww .a-offscreen"];

/** URL d'image Amazon canonique (petit JPEG 300 px, lisible sur tous les iPhone — pas le chemin AVIF de session). */
function cleanImage(u) {
  const m = String(u || "").match(/\/images\/I\/([A-Za-z0-9+%_-]+?)\./);
  return m ? `https://m.media-amazon.com/images/I/${m[1]}._AC_SL300_.jpg` : "";
}

function parsePrice(s) {
  const m = String(s || "").replace(/\s| /g, "").match(/(\d+(?:[.,]\d{1,2})?)€?/);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** Vérifie la fiche EXACTE /dp/ASIN : disponibilité, prix, vendeur, image. */
async function check(page, asin) {
  await page.goto(`https://www.amazon.fr/dp/${asin}?th=1&psc=1&language=fr_FR`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const res = await page.evaluate((PRICE_SEL) => {
    const q = (s) => document.querySelector(s);
    const txt = (s) => (q(s)?.innerText || "").trim();
    let price = ""; for (const s of PRICE_SEL) { const t = (q(s)?.textContent || "").trim(); if (t) { price = t; break; } }
    return {
      pageAsin: q("input#ASIN")?.value || q("input[name='ASIN']")?.value || (location.pathname.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || "",
      title: txt("#productTitle"),
      availability: (txt("#availability") || txt("#outOfStock") || "").split(/\s{2,}|\{/)[0].trim(),
      buyNow: !!q("#buy-now-button"), addToCart: !!q("#add-to-cart-button"),
      price, image: q("#landingImage")?.getAttribute("data-old-hires") || q("#landingImage")?.src || "",
      seller: txt("#merchantInfoFeature_feature_div .offer-display-feature-text") || txt("#sellerProfileTriggerId") || txt("#merchant-info"),
      dogs: /Nous sommes désolés|Page introuvable|Looking for something/.test(document.title + document.body.innerText.slice(0, 300)),
    };
  }, PRICE_SEL);
  const avail = res.availability.toLowerCase();
  // Sans « Acheter maintenant » mais avec « Ajouter au panier » (ex. une autre commande en cours → « Ajouter à la livraison ») : PAS une rupture.
  const out = res.dogs || /actuellement indisponible|indisponible|currently unavailable|rupture/.test(avail) || (!res.buyNow && !res.addToCart);
  return {
    asin, exact: res.pageAsin === asin, title: res.title, available: !out, buyNow: res.buyNow, availability: res.availability || (res.buyNow || res.addToCart ? "En stock" : "Pas d'achat possible"),
    price: parsePrice(res.price), priceText: res.price, image: cleanImage(res.image), seller: res.seller,
  };
}

/** Commande la référence EXACTE via « Acheter maintenant » (adresse et paiement par défaut du compte).
 *  dryRun : s'arrête juste avant « Passer la commande ». Renvoie {ok, orderId?, total?, reason?}. */
async function buy(page, asin, qty = 1, { dryRun = false, maxPrice = null } = {}) {
  // Anti-doublon : déjà commandé aujourd'hui (relance, détection ratée la veille…) → on ne recommande pas.
  const already = await findTodayOrder(page, asin).catch(() => null);
  if (already) return { ok: true, orderId: already.orderId, total: already.total, flow: "déjà commandé aujourd'hui" };
  const c = await check(page, asin);
  if (!c.exact) return { ok: false, reason: "La fiche ne correspond plus à la référence exacte", check: c };
  if (!c.available) return { ok: false, reason: "Rupture / indisponible : " + c.availability, check: c };
  if (maxPrice && c.price && c.price > maxPrice) return { ok: false, reason: `Prix anormal ${c.price} € (> ${maxPrice} €)`, check: c };
  let viaCart = null;
  if (c.buyNow) {
    if (qty > 1) await page.selectOption("#quantity", String(qty)).catch(() => {});
    await page.click("#buy-now-button");
  } else {
    // Pas d'« Acheter maintenant » (ex. une autre commande en cours → « Ajouter à la livraison ») :
    // on passe par le panier, avec cet article SEUL (les autres sont mis de côté puis remis).
    viaCart = await cartCheckout(page, asin, qty);
    if (!viaCart.ok) { await restoreCart(page, asin, viaCart.savedAside); return { ok: false, retry: true, reason: viaCart.reason + " — nouvel essai demain", check: c }; }
  }
  const res = await placeOrder(page, asin, qty, { dryRun, maxPrice, c });
  if (viaCart && (!res.ok || res.dryRun)) await restoreCart(page, asin, viaCart.savedAside);
  else if (viaCart?.savedAside.length) await restoreCart(page, null, viaCart.savedAside);
  if (viaCart && res.flow) res.flow += " via panier";
  return res;
}

const CART = "https://www.amazon.fr/gp/cart/view.html?language=fr_FR";
const activeItems = (page) => page.evaluate(() => [...document.querySelectorAll("#sc-active-cart [data-asin][data-itemtype='active']")]
  .map(e => ({ asin: e.dataset.asin, qty: Number(e.dataset.quantity || 1), sns: /abonnement|livraison tous les|toutes les \d+ (semaines|mois)|fréquence de livraison/i.test(e.innerText) })));

/** Met l'article seul dans le panier (achat ponctuel, PAS l'abonnement) puis ouvre la page de paiement. */
async function cartCheckout(page, asin, qty) {
  const savedAside = [];
  await page.goto(CART, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 15; i++) {
    const items = await activeItems(page);
    if (!items.length) break;
    const btn = page.locator(`#sc-active-cart [data-asin='${items[0].asin}'][data-itemtype='active'] input[name^='submit.save-for-later']`).first();
    if (!(await btn.count())) return { ok: false, savedAside, reason: "Panier non vide et impossible de mettre de côté " + items[0].asin };
    if (items[0].asin !== asin) savedAside.push(items[0].asin);
    await btn.click(); await page.waitForTimeout(2500);
    await page.goto(CART, { waitUntil: "domcontentloaded" });
  }
  if ((await activeItems(page)).length) return { ok: false, savedAside, reason: "Impossible de vider le panier" };
  await page.goto(`https://www.amazon.fr/dp/${asin}?psc=1&language=fr_FR`, { waitUntil: "domcontentloaded" });
  if (qty > 1) await page.selectOption("#quantity", String(qty)).catch(() => {});
  const atc = page.locator("input#add-to-cart-button:not([value*='abonnement' i])").first();
  if (!(await atc.count())) return { ok: false, savedAside, reason: "Bouton « Ajouter au panier » introuvable" };
  await atc.click(); await page.waitForTimeout(3000);
  await page.goto(CART, { waitUntil: "domcontentloaded" });
  const items = await activeItems(page);
  if (items.length !== 1 || items[0].asin !== asin || items[0].sns || items[0].qty !== qty)
    return { ok: false, savedAside, reason: "Panier inattendu après ajout : " + JSON.stringify(items) };
  const ptc = page.locator("input[name='proceedToRetailCheckout'], #sc-buy-box-ptc-button input").first();
  if (!(await ptc.count())) return { ok: false, savedAside, reason: "Bouton « Passer la commande » du panier introuvable" };
  await ptc.click();
  await page.waitForLoadState("domcontentloaded");
  return { ok: true, savedAside };
}

/** Retire l'article du panier (si asin) et remet dans le panier les articles mis de côté. Ne lève jamais. */
async function restoreCart(page, asin, savedAside = []) {
  try {
    await page.goto(CART, { waitUntil: "domcontentloaded" });
    if (asin) {
      const del = page.locator(`#sc-active-cart [data-asin='${asin}'][data-itemtype='active'] input[name^='submit.delete']`).first();
      if (await del.count()) { await del.click(); await page.waitForTimeout(2500); await page.goto(CART, { waitUntil: "domcontentloaded" }); }
    }
    for (const a of savedAside) {
      const mv = page.locator(`[data-asin='${a}'][data-itemtype='saved'] input[name^='submit.move-to-cart']`).first();
      if (await mv.count()) { await mv.click(); await page.waitForTimeout(2500); await page.goto(CART, { waitUntil: "domcontentloaded" }); }
    }
  } catch {}
}

/** Depuis la page de paiement (turbo ou classique) : contrôle du total puis « Passer la commande ». */
async function placeOrder(page, asin, qty, { dryRun, maxPrice, c }) {
  // Deux parcours possibles : panneau « turbo checkout » (iframe) ou page de paiement classique.
  const turbo = page.frameLocator("#turbo-checkout-iframe");
  const turboBtn = turbo.locator("#turbo-checkout-pyo-button");
  const classicBtn = page.locator("#submitOrderButtonId input, input[name='placeYourOrder1'], #placeOrder, #bottomSubmitOrderButtonId input");
  const which = await Promise.race([
    turboBtn.waitFor({ timeout: 25000 }).then(() => "turbo").catch(() => null),
    classicBtn.first().waitFor({ timeout: 25000 }).then(() => "classic").catch(() => null),
  ]);
  if (!which) return { ok: false, reason: "Page de paiement introuvable (" + page.url() + ")", check: c };
  const scope = which === "turbo" ? turbo.locator("body") : page.locator("body");
  const summary = (await scope.innerText().catch(() => "")).replace(/\s+/g, " ");
  const total = parsePrice((summary.match(/(?:Montant total|Total de la commande|Total)\s*:?\s*([\d\s.,]+\s?€)/i) || [])[1]);
  if (maxPrice && total && total > maxPrice * qty + 8) return { ok: false, reason: `Total anormal ${total} €`, check: c };
  if (dryRun) return { ok: true, dryRun: true, flow: which, total, check: c };
  await (which === "turbo" ? turboBtn.click() : classicBtn.first().click());
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  const okMsg = /commande (a été )?passée|merci, votre commande|order placed|confirmation de commande/i.test(body) || /thankyou|thank-you/.test(page.url());
  const orderId = (body.match(/\b(\d{3}-\d{7}-\d{7})\b/) || [])[1] || null;
  if (okMsg) {
    const found = orderId ? null : await findTodayOrder(page, asin).catch(() => null); // n° de commande pour le journal
    return { ok: true, orderId: orderId || found?.orderId || null, total, flow: which, check: c };
  }
  // Amazon intercale parfois une page (pub Prime /cpe/executions…) après la validation : on vérifie dans l'historique.
  const url = page.url();
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(i ? 15000 : 3000);
    const found = await findTodayOrder(page, asin).catch(() => null);
    if (found) return { ok: true, orderId: found.orderId || orderId, total: found.total ?? total, flow: which + " (vérifié dans l'historique)", check: c };
  }
  return { ok: false, reason: "Confirmation de commande non détectée, absente de l'historique (" + url + ")", check: c };
}

/** Cherche dans l'historique une commande passée AUJOURD'HUI contenant cet ASIN. Renvoie {orderId, total} ou null. */
async function findTodayOrder(page, asin) {
  const todayFr = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  await page.goto("https://www.amazon.fr/gp/css/order-history?language=fr_FR", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const html = await page.content();
  for (const seg of html.split(/commande effectu(?:é|&eacute;|e)e le/i).slice(1)) {
    const head = seg.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ").slice(0, 400);
    if (!head.includes(todayFr) || !new RegExp("/(?:dp|gp/product)/" + asin).test(seg)) continue;
    return { orderId: (head.match(/\b(\d{3}-\d{7}-\d{7})\b/) || [])[1] || null, total: parsePrice((head.match(/TOTAL\s*([\d\s.,]+\s?€)/i) || [])[1]) };
  }
  return null;
}

module.exports = { open, login, isLoggedIn, check, buy, findTodayOrder, cleanImage, PROFILE };
