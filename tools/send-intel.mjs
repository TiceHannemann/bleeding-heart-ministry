// Sends the relay's analysed items (intel/inbox/items/*.json) to the Ministry server, where they join the
// briefings as open-channel signals, then moves each sent item to intel/inbox/processed/.
// Usage:  node tools/send-intel.mjs --server http://YOUR-VPS-IP:8080        (token from CHAT_UPLOAD_TOKEN)
//         node tools/send-intel.mjs --server ... --token-file .env  |  --dry
import fs from "node:fs";
import path from "node:path";

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes("--dry");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const ITEMS = path.join(ROOT, "intel/inbox/items"), DONE = path.join(ROOT, "intel/inbox/processed");

let token = process.env.CHAT_UPLOAD_TOKEN;
if (arg("--token-file")) token = (fs.readFileSync(arg("--token-file"), "utf8").match(/^CHAT_UPLOAD_TOKEN=(.+)$/m) || [])[1]?.trim();
const server = arg("--server") || process.env.BH_SERVER;

const files = fs.readdirSync(ITEMS).filter(f => f.endsWith(".json"));
const items = files.map(f => JSON.parse(fs.readFileSync(path.join(ITEMS, f), "utf8")));
for (const i of items) console.log(`${DRY ? "would send" : "sending"}  ${i.item_id}  (${i.type}, importance ${i.importance})`);
if (!items.length) { console.log("Nothing in intel/inbox/items."); process.exit(0); }
if (DRY) process.exit(0);
if (!server || !token) { console.error("Need --server (or BH_SERVER) and CHAT_UPLOAD_TOKEN (or --token-file)."); process.exit(1); }

const res = await fetch(server.replace(/\/$/, "") + "/api/chat-import", {
  method:"POST", headers:{ "x-chat-token":token, "content-type":"application/json; charset=utf-8" }, body:JSON.stringify({ items }),
});
const r = await res.json().catch(() => ({}));
if (!res.ok) { console.error("FAILED:", r.error || res.status); process.exit(1); }
for (const f of files) fs.renameSync(path.join(ITEMS, f), path.join(DONE, f));
console.log(r.message || "Sent.", `${files.length} item(s) moved to intel/inbox/processed/.`);
