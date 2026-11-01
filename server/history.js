// The Ministry's history of Terra Nostra: a narrative written from the Discord archives (tools/discord-digest.js
// distils them) and sent with tools/send-history.ps1. It lives on the data volume rather than in the repository,
// because it names the servers the Ministry reads. The page gets it as meta "history".
const fs = require("fs");
const path = require("path");
const { DATA, readJSON, writeJSON } = require("./paths");

const DIR = path.join(DATA, "history"), FILE = path.join(DIR, "history.json");

const get = () => readJSON(FILE);
function save(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error("That isn't JSON."); }
  if (j?.kind !== "terra-nostra-history" || !Array.isArray(j.chapters) || !j.asOf) throw new Error("That file isn't a Ministry history.");
  fs.mkdirSync(DIR, { recursive:true });
  writeJSON(FILE, j);
  return { chapters:j.chapters.length, events:(j.timeline || []).length, asOf:j.asOf };
}
const status = () => { const h = get(); return h ? { asOf:h.asOf, chapters:h.chapters.length, events:(h.timeline || []).length, sources:(h.sources || []).length } : null; };

module.exports = { get, save, status };
