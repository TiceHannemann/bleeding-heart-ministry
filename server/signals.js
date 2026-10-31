// Open-channel signals: in-game diplomacy and intelligence read from public Discord channels.
// DiscordChatExporter JSON files arrive in DATA/chat/inbox (or through POST /api/chat-import). Each hour,
// before the reports are written, new messages are cleaned up in code (no cost), then Claude reads them and
// returns only real in-game events: treaties, wars, mergers, raids, recruitment, leadership changes.
// Memes, small talk and real-world politics are dropped. Events are merged across servers and hours,
// and handed to the page as meta "signals" for the briefings.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DATA, readJSON, writeJSON } = require("./paths");

const DIR = path.join(DATA, "chat"), INBOX = path.join(DIR, "inbox"), STORE = path.join(DIR, "store.json");
fs.mkdirSync(INBOX, { recursive:true });
const KEEP_MESSAGES = 30 * 864e5, KEEP_EVENTS = 90 * 864e5;
const MODEL = process.env.SIGNALS_MODEL || "claude-opus-5-5";
const BATCH_CHARS = 60000; // about 15,000 tokens of chat per request

const load = () => Object.assign({ msgs:{}, events:[], usage:{ input:0, output:0, calls:0 } }, readJSON(STORE) || {});
const enabled = () => !!process.env.ANTHROPIC_API_KEY || !!global.__signalsClient;

/* ---------- intake: DiscordChatExporter JSON -> compact messages ---------- */
const NOISE = /^\[Original Message Deleted\]$|^(Joined the server\.|Pinned a message\.)$/i;
function textOf(m) {
  const parts = [m.content, ...(m.embeds || []).flatMap(e => [e.title, e.description, ...(e.fields || []).map(f => f.name && !/^poll_|_id$|votes$/.test(f.name) ? `${f.name}: ${f.value}` : null)])];
  return parts.filter(Boolean).join(" ").replace(/<a?:(\w+):\d+>/g, ":$1:").replace(/\s+/g, " ").trim();
}
// the author's two most senior named roles say whether they speak for a nation ("Chancellor", "Count of Germany")
const rolesOf = a => (a?.roles || []).filter(r => r.name && r.name.length > 1 && !/ping|member|everyone|reader|people|citizen$/i.test(r.name)).sort((x, y) => y.position - x.position).slice(0, 2).map(r => r.name);
function ingest(json, store) {
  const j = typeof json === "string" ? JSON.parse(json) : json;
  if (!j?.guild || !Array.isArray(j.messages)) throw new Error("not a DiscordChatExporter JSON export");
  let added = 0;
  for (const m of j.messages) {
    if (!m?.id || store.msgs[m.id] || !/^(Default|Reply)$/.test(m.type || "Default")) continue;
    const text = textOf(m);
    if (text.length < 12 || NOISE.test(text)) continue;
    const at = Date.parse(m.timestamp);
    if (!(at > Date.now() - KEEP_MESSAGES)) continue;
    store.msgs[m.id] = { at, g:j.guild.name, c:j.channel?.name || "", news:j.channel?.type === "GuildNews" || /news|announce|notice|release/i.test(j.channel?.name || ""),
      a:m.author?.nickname || m.author?.name || "?", bot:!!m.author?.isBot, r:rolesOf(m.author), t:text.slice(0, 1500), done:false };
    added++;
  }
  return added;
}
function ingestInbox(store) {
  let files = 0, added = 0;
  for (const f of fs.readdirSync(INBOX).filter(f => f.endsWith(".json"))) {
    const p = path.join(INBOX, f);
    try { added += ingest(fs.readFileSync(p, "utf8"), store); files++; fs.rmSync(p); }
    catch (e) { console.warn("signals: couldn't read", f, e.message); fs.renameSync(p, p + ".bad"); }
  }
  return { files, added };
}
// uploads go straight to the inbox; they are read at the next hourly run
function receive(body) {
  const j = JSON.parse(body);
  if (!j?.guild || !Array.isArray(j.messages)) throw new Error("That isn't a DiscordChatExporter JSON export.");
  fs.writeFileSync(path.join(INBOX, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`), body);
  return j.messages.length;
}

/* ---------- extraction with Claude ---------- */
const TYPES = ["alliance", "non_aggression_pact", "war_or_hostility", "peace_or_truce", "merger_or_annexation", "town_transfer",
  "raid_or_attack_plan", "recruitment", "sanctions_or_trade", "leadership_or_internal", "server_news", "other_intel"];
const SCHEMA = {
  type:"object", additionalProperties:false, required:["events"],
  properties:{ events:{ type:"array", items:{ type:"object", additionalProperties:false,
    required:["type", "nations", "summary", "confidence", "status", "importance", "source_ids"],
    properties:{
      type:{ type:"string", enum:TYPES },
      nations:{ type:"array", items:{ type:"string" } },
      summary:{ type:"string" },
      confidence:{ type:"string", enum:["low", "moderate", "high"] },
      status:{ type:"string", enum:["announced_officially", "reported", "rumoured", "denied"] },
      importance:{ type:"integer", enum:[1, 2, 3, 4, 5] },
      source_ids:{ type:"array", items:{ type:"string" } },
    } } } },
};
const SYSTEM = `You are an analyst for the Ministry of Intelligence of the Kingdom of The Bleeding Heart, a nation on the EarthMC Minecraft server (Terra Nostra world). EarthMC nations are player groups named after real countries and regions, so "Germany" or "Brazil" usually means the in-game nation, but players also talk about real-world history and politics.

You will read messages from public Discord channels of EarthMC communities. Report only in-game diplomacy and intelligence that would matter to a nation's government:
- alliances, non-aggression pacts, treaties, peace or truces, sanctions and trade deals
- wars, declarations of hostility, threats, raids or attacks being planned or carried out
- mergers, annexations, towns joining or leaving nations
- recruitment drives aimed at another nation's members
- leadership changes, coups, resignations, internal unrest
- server-wide news that changes the political picture

Ignore memes, jokes, greetings, small talk, game help, events and giveaways, and every discussion of real-world history or politics. A message about the real Soviet Union invading the real Germany is not an event. When you are unsure whether a remark is in-game, leave it out.

Write each summary as one sentence in the past tense, in plain formal English, as it would appear in a government intelligence report (for example: "Denmark and Rhodesia signed a non-aggression pact"). Use nation names exactly as they appear in the list of known nations when they match one. Merge reports of the same event, including the same news story reposted in several servers, into one event that cites every source id. Set confidence from the source: official announcements and established news outlets are high, a nation's officials speaking are moderate to high, a single ordinary member is low. Set importance from 1 (minor) to 5 (changes the balance of power). Return an empty list when nothing qualifies, which will often be the case.`;

const fmtMsg = (id, m) => `[${id}] ${new Date(m.at).toISOString().slice(0, 16).replace("T", " ")} | ${m.g} #${m.c}${m.news ? " (news channel)" : ""} | ${m.a}${m.bot ? " [bot]" : ""}${m.r.length ? ` (${m.r.join(", ")})` : ""}: ${m.t}`;

let client = null;
async function extract(batch, nationNames) {
  if (!client) client = global.__signalsClient || new (require("@anthropic-ai/sdk"))(); // tests supply a stand-in client
  const lines = batch.map(([id, m]) => fmtMsg(id, m)).join("\n");
  const res = await client.beta.messages.create({
    model:MODEL, max_tokens:16000,
    // a refused request is re-run on a suitable model instead of failing the hour
    betas:["server-side-fallback-2026-07-01"], fallbacks:"default",
    output_config:{ effort:"medium", format:{ type:"json_schema", schema:SCHEMA } },
    // the system prompt and nation list don't change between hours, so they are cached
    system:[{ type:"text", text:SYSTEM }, { type:"text", text:"Known nations on Terra Nostra: " + nationNames.join(", "), cache_control:{ type:"ephemeral" } }],
    messages:[{ role:"user", content:`Messages (oldest first):\n${lines}` }],
  });
  if (res.stop_reason === "refusal") throw new Error("the model declined this batch" + (res.stop_details?.category ? ` (${res.stop_details.category})` : ""));
  if (res.stop_reason === "max_tokens") throw new Error("the answer was cut off");
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  return { events:JSON.parse(text).events || [], usage:res.usage };
}

// the same event reported again (another server, a later hour) joins the existing one
const evKey = e => e.type + "|" + [...e.nations].map(n => n.toLowerCase().replace(/[\s_]+/g, " ")).sort().join("+") + "|" + new Date(e.at).toISOString().slice(0, 10);
function merge(store, found, msgs) {
  for (const e of found) {
    const src = e.source_ids.map(id => msgs[id] && { id, guild:msgs[id].g, channel:msgs[id].c, author:msgs[id].a, role:msgs[id].r[0] || null, at:msgs[id].at }).filter(Boolean);
    if (!src.length || !e.nations.length) continue;
    const ev = { type:e.type, nations:e.nations, summary:e.summary, confidence:e.confidence, status:e.status, importance:e.importance,
      at:Math.min(...src.map(s => s.at)), last:Math.max(...src.map(s => s.at)), sources:src };
    const old = store.events.find(o => evKey(o) === evKey(ev));
    if (!old) { store.events.push(ev); continue; }
    const have = new Set(old.sources.map(s => s.id));
    old.sources.push(...src.filter(s => !have.has(s.id)));
    old.last = Math.max(old.last, ev.last); old.importance = Math.max(old.importance, ev.importance);
    if (["low", "moderate", "high"].indexOf(ev.confidence) > ["low", "moderate", "high"].indexOf(old.confidence)) Object.assign(old, { confidence:ev.confidence, summary:ev.summary });
    if (ev.status === "announced_officially" || ev.status === "denied") old.status = ev.status;
  }
  for (const e of store.events) e.servers = new Set(e.sources.map(s => s.guild)).size;
}

/* ---------- the hourly run ---------- */
let lastRun = null;
async function run(nationNames) {
  const store = load(), t0 = Date.now();
  const inbox = ingestInbox(store);
  // forget old raw messages; keep events longer
  for (const [id, m] of Object.entries(store.msgs)) if (m.at < Date.now() - KEEP_MESSAGES) delete store.msgs[id];
  store.events = store.events.filter(e => e.last > Date.now() - KEEP_EVENTS);
  const todo = Object.entries(store.msgs).filter(([, m]) => !m.done).sort((a, b) => a[1].at - b[1].at);
  // the same text posted in several servers (news bots) is read once; the copies are marked done with it
  const seen = new Map(), batches = [[]];
  let size = 0;
  for (const [id, m] of todo) {
    const k = m.t.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(k)) { m.dupOf = seen.get(k); continue; }
    seen.set(k, id);
    if (size + m.t.length > BATCH_CHARS && batches[batches.length - 1].length) { batches.push([]); size = 0; }
    batches[batches.length - 1].push([id, m]); size += m.t.length + 80;
  }
  let found = 0, err = null;
  if (enabled()) for (const batch of batches.filter(b => b.length)) {
    try {
      const { events, usage } = await extract(batch, nationNames);
      // a reposted copy counts as a source for its original
      for (const e of events) for (const [id] of todo) if (e.source_ids.includes(store.msgs[id]?.dupOf)) e.source_ids.push(id);
      merge(store, events, store.msgs);
      found += events.length;
      store.usage.input += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      store.usage.output += usage.output_tokens || 0; store.usage.calls++;
      for (const [id] of batch) store.msgs[id].done = true;
      for (const [, m] of todo) if (m.dupOf && store.msgs[m.dupOf]?.done) m.done = true;
    } catch (e) {
      err = String(e.message || e).slice(0, 300); console.warn("signals: extraction failed:", err);
      break; // leave the rest for next hour
    }
  }
  writeJSON(STORE, store);
  lastRun = { at:t0, files:inbox.files, newMessages:inbox.added, read:batches.flat().length, found, events:store.events.length, pending:Object.values(store.msgs).filter(m => !m.done).length,
    error:enabled() ? err : "ANTHROPIC_API_KEY is not set: chat is collected but not analysed.", usage:store.usage };
  if (inbox.added || found || err) console.log(`signals: ${inbox.added} new messages from ${inbox.files} files · ${found} events found · ${store.events.length} on record${lastRun.error ? " · " + lastRun.error : ""}`);
  return store.events;
}
const status = () => lastRun;
const events = () => load().events;

module.exports = { run, receive, status, events, ingest, INBOX };
