// Envoi iMessage via Messages.app (Mac de Thomas).
const { execFileSync } = require("child_process");
const MARIE = "+33607688499";
const THOMAS = "thomaslefevre18@live.fr";
function send(to, text) {
  if (process.env.AMZ_DRY_NOTIFY) { console.log(`--- iMessage → ${to}\n${text}\n---`); return; }
  const script = `on run argv
  with timeout of 90 seconds
    tell application "Messages" to send (item 2 of argv) to participant (item 1 of argv) of (1st account whose service type = iMessage)
  end timeout
end run`;
  // Messages peut être endormi au réveil du Mac (AppleEvent -1712) : on le lance puis on réessaie.
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      if (i) { execFileSync("open", ["-g", "-a", "Messages"]); execFileSync("sleep", [String(10 * i)]); }
      execFileSync("osascript", ["-e", script, to, text]);
      return;
    } catch (e) { err = e; }
  }
  throw new Error("iMessage non envoyé à " + to + " : " + String(err.stderr || err.message).trim().slice(0, 150));
}
module.exports = { send, MARIE, THOMAS, marie: (t) => send(MARIE, t), thomas: (t) => send(THOMAS, t) };
