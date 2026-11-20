// Met à jour prix / stock / image de chaque article (vérification sur la fiche exacte).
const amz = require("../lib/amazon"), st = require("../lib/state");
(async () => {
  const { state } = await st.load();
  const { ctx, page } = await amz.open();
  if ((await amz.login(page)) !== "ok") { console.error("non connecté"); process.exit(2); }
  const results = {};
  for (const it of state.items) {
    const c = await amz.check(page, it.asin).catch(e => ({ error: String(e) }));
    results[it.asin] = c;
    console.log(`${c.available ? "✅" : "⚠️ "} ${it.asin} ${c.exact ? "" : "(≠ASIN) "}${c.price ?? "?"} € | ${(c.availability || c.error || "").slice(0, 40)} | ${it.title.slice(0, 50)}`);
  }
  await ctx.close();
  await st.update(s => { for (const it of s.items) { const c = results[it.asin]; if (!c || c.error) continue;
    it.price = c.price ?? it.price; it.image = c.image || it.image; it.status = c.available && c.exact ? "ok" : "rupture";
    it.availability = c.availability; it.checkedAt = new Date().toISOString(); } }, "vérification stock/prix");
})();
