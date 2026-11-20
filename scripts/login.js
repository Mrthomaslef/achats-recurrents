// Connexion initiale / renouvellement de session Amazon (compte de Marie).
const amz = require("../lib/amazon");
(async () => {
  const headless = !process.argv.includes("--show");
  const { ctx, page } = await amz.open({ headless });
  const r = await amz.login(page);
  console.log("login:", r, page.url().slice(0, 80));
  if (!headless && r !== "ok") await page.waitForTimeout(180000); // laisse le temps de saisir un code
  await ctx.close();
  process.exit(r === "ok" ? 0 : 1);
})();
