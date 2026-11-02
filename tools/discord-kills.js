// Reads Discord exports (DiscordChatExporter JSON) of any size for the kills EarthMC's in-game chat bridge posts
// ("☠ Victim was killed by Killer"), writes them to kills.json, and can send them to the Ministry server.
// Usage:  node tools/discord-kills.js <export file or folder> [out.json] [--send http://YOUR-SITE:8080 --token CHAT_UPLOAD_TOKEN]
// Exports are read line by line, so a file of several gigabytes needs no more memory than a small one.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { parseDeath } = require("../server/deaths");

const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const server = opt("--send"), token = opt("--token");
const [src, outArg] = args;
if (!src) { console.log("Usage: node tools/discord-kills.js <export file or folder> [out.json] [--send http://YOUR-SITE:8080 --token TOKEN]"); process.exit(1); }
const files = fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter(f => f.endsWith(".json")).map(f => path.join(src, f)) : [src];
const out = outArg || path.join(fs.statSync(src).isDirectory() ? src : path.dirname(src), "kills.json");

// message objects sit at a fixed indent in DiscordChatExporter's output: their id and timestamp are 6 spaces in
async function read(file) {
  const kills = [];
  let id = null, at = null;
  const rl = readline.createInterface({ input:fs.createReadStream(file, { encoding:"utf8" }), crlfDelay:Infinity });
  for await (const line of rl) {
    if (line.startsWith('      "id": "')) { id = line.slice(13, line.indexOf('"', 13)); continue; }
    if (line.startsWith('      "timestamp": "')) { at = Date.parse(line.slice(20, line.indexOf('"', 20))); continue; }
    if (!line.includes("☠")) continue;
    const m = /"(?:name|title|description|content)": ("(?:[^"\\]|\\.)*")/.exec(line); if (!m) continue;
    let text; try { text = JSON.parse(m[1]); } catch { continue; }
    const kv = parseDeath(text);
    if (kv && at) kills.push([at, kv[0], kv[1], id]);
  }
  return kills;
}

(async () => {
  const all = [], seen = new Set();
  for (const f of files) {
    const k = await read(f);
    for (const x of k) if (!seen.has(x[3])) { seen.add(x[3]); all.push(x); }
    if (k.length) console.log(`${path.basename(f)}: ${k.length.toLocaleString()} kills`);
  }
  all.sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(out, JSON.stringify({ kind:"kills", made:Date.now(), kills:all }));
  console.log(`${all.length.toLocaleString()} kills${all.length ? `, ${new Date(all[0][0]).toISOString().slice(0, 10)} to ${new Date(all[all.length - 1][0]).toISOString().slice(0, 10)}` : ""} -> ${out}`);
  if (!server) return;
  const r = await fetch(server.replace(/\/+$/, "") + "/api/kills-import", { method:"POST", headers:{ "Content-Type":"application/json", "x-chat-token":token || "" }, body:fs.readFileSync(out, "utf8") });
  const j = await r.json().catch(() => ({}));
  console.log(r.ok ? j.message : `The server refused it: ${j.error || r.status}`);
})();
