// Génère docs/data/vault.js (jeton GitHub chiffré) et docs/data/embedded_data.js (copie hors-ligne chiffrée).
// Clé d'accès de l'app : trousseau « achats-recurrents-app » (créée au premier lancement), transmise à Marie dans le lien #k=…
const crypto = require("crypto"), fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const st = require("../lib/state");
const VAULT = "/Users/thomaslefevre/.t3/bin/t3-vault";
const get = (svc) => { try { return execFileSync(VAULT, ["get", svc, "--field", "password"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

let code = get("achats-recurrents-app");
if (!code) {
  code = crypto.randomBytes(16).toString("base64url");
  const f = path.join(os.tmpdir(), ".amz_code"); fs.writeFileSync(f, code, { mode: 0o600 });
  execFileSync(VAULT, ["set", "achats-recurrents-app", "--user", "Marie (lien app)", "--password-file", f, "--url", "https://mrthomaslef.github.io/achats-recurrents/"]);
  fs.unlinkSync(f);
}
const key = crypto.createHash("sha256").update(code).digest();
const seal = (txt) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(txt, "utf8"), c.final(), c.getAuthTag()]); return { iv: iv.toString("base64"), ct: ct.toString("base64") }; };

(async () => {
  const out = path.join(__dirname, "../docs/data");
  fs.writeFileSync(path.join(out, "vault.js"), "window.AMZ_VAULT = " + JSON.stringify(seal(get("github-amazon-recurrent-state"))) + ";\n");
  const { state } = await st.load();
  fs.writeFileSync(path.join(out, "embedded_data.js"), "window.AMZ_ENC = " + JSON.stringify(seal(JSON.stringify(state))) + ";\n");
  console.log("app chiffrée OK —", state.items.length, "articles");
})();
