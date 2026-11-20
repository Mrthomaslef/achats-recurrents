// État partagé app <-> Mac : fichier state.json du dépôt privé GitHub Mrthomaslef/amazon-recurrent-state.
const { execFileSync } = require("child_process");
const API = "https://api.github.com/repos/Mrthomaslef/amazon-recurrent-state/contents/state.json";
const token = () => execFileSync("/Users/thomaslefevre/.t3/bin/t3-vault", ["get", "github-amazon-recurrent-state", "--field", "password"], { encoding: "utf8" }).trim();
const H = () => ({ Authorization: "Bearer " + token(), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });

async function load() {
  const r = await fetch(API + "?t=" + Date.now(), { headers: H() });
  if (!r.ok) throw new Error("GitHub load " + r.status);
  const j = await r.json();
  return { state: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha };
}
async function put(state, sha, message) {
  state.updated = new Date().toISOString();
  const r = await fetch(API, { method: "PUT", headers: H(), body: JSON.stringify({ message, sha, content: Buffer.from(JSON.stringify(state, null, 1)).toString("base64") }) });
  if (!r.ok) { const e = new Error("GitHub save " + r.status); e.status = r.status; throw e; }
  return (await r.json()).content.sha;
}
/** Modifie l'état de façon sûre (relit et réapplique en cas d'écriture concurrente depuis l'app). */
async function update(mutator, message = "maj automatique") {
  for (let i = 0; i < 4; i++) {
    const { state, sha } = await load();
    const res = await mutator(state);
    try { await put(state, sha, message); return { state, res }; }
    catch (e) { if (e.status !== 409 && e.status !== 422) throw e; }
  }
  throw new Error("Conflit d'écriture persistant");
}
module.exports = { load, update };
