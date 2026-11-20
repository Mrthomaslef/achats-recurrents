// Envoi iMessage via Messages.app (Mac de Thomas).
const { execFileSync } = require("child_process");
const MARIE = "+33607688499";
const THOMAS = "thomaslefevre18@live.fr";
function send(to, text) {
  if (process.env.AMZ_DRY_NOTIFY) { console.log(`--- iMessage → ${to}\n${text}\n---`); return; }
  const script = `on run argv
  tell application "Messages" to send (item 2 of argv) to participant (item 1 of argv) of (1st account whose service type = iMessage)
end run`;
  execFileSync("osascript", ["-e", script, to, text]);
}
module.exports = { send, MARIE, THOMAS, marie: (t) => send(MARIE, t), thomas: (t) => send(THOMAS, t) };
