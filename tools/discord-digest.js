// Distil DiscordChatExporter JSON exports of any size (the in-game chat bridge runs past a gigabyte) into what a
// historian needs: every announcement, and the chat lines that speak of wars, alliances, treaties, mergers, raids,
// elections and the like. One pass per file, one message in memory at a time.
//
//   node tools/discord-digest.js <exports folder> <out folder> [--since 2026-03-01]
//
// Writes to <out folder>:
//   sources.json   each channel: guild, kind (announcements / chat / bridge), messages, speakers, first and last date,
//                  messages per month, and which nations it talks about
//   kept.jsonl     the messages worth reading, one per line: { t, g, c, k, a, r, x, s, n, rx }
//   digest/YYYY-MM.txt   the same, as plain text by month, ready to read: announcements in full, chat ranked and capped per day
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const [IN, OUT] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const opt = k => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : null; };
const SINCE = Date.parse(opt("since") || "2026-03-01");
const CHAT_PER_DAY = +opt("chat-per-day") || 12, BRIDGE_PER_DAY = +opt("bridge-per-day") || 18;
if (!IN || !OUT) { console.error("usage: node tools/discord-digest.js <exports folder> <out folder> [--since YYYY-MM-DD]"); process.exit(1); }

// what makes a chat line worth keeping: diplomacy, conflict and government words, and the names of nations
const STRONG = /\b(wars?|declar\w*|allian\w*|allied|allies|nap|non[- ]?aggression|treat(y|ies)|pacts?|truce|ceasefire|peace deal|annex\w*|merg\w*|federation|coalition|sanction\w*|embargo\w*|raid\w*|sieg\w*|invad\w*|invasion|conquer\w*|occup\w*|rebel\w*|revolt|coup|civil war|independen\w*|seced\w*|seccession|vassal\w*|puppet|protectorate|meganation|betray\w*|traitor|spies|spy|abdicat\w*|elect(ed|ion|ions)|referendum|overclaim\w*|genocide|nuked?|disband\w*|dissolv\w*|collapse\w*|bloc)\b/gi;
const WEAK = /\b(attack\w*|ally|leader|king|queen|emperor|empress|president|chancellor|kaiser|capital|empire|kingdom|republic|claims?|border\w*|territor\w*|army|soldiers?|pvp|town|nation)\b/gi;
const nationList = () => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, "nations.json"), "utf8")); } catch { return []; }
};

async function nations() {
  let list = nationList();
  if (!list.length) {
    try { list = (await (await fetch("https://api.earthmc.net/v4/nations")).json()).map(n => n.name); fs.mkdirSync(OUT, { recursive:true }); fs.writeFileSync(path.join(OUT, "nations.json"), JSON.stringify(list)); }
    catch (e) { console.warn("nation list unavailable:", e.message); }
  }
  // names that are also everyday words would match everything
  const common = new Set(["peace", "union", "empire", "kingdom", "republic", "nation", "town", "home", "free", "north", "south", "east", "west", "new", "the"]);
  return new Map(list.filter(n => n.length >= 4 && !common.has(n.toLowerCase())).map(n => [n.toLowerCase(), n]));
}
// nations named in a text: single words, and two- or three-word names written with spaces or underscores
function named(NAT, text) {
  const w = text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean), out = new Set();
  for (let i = 0; i < w.length; i++) for (const k of [w[i], w[i] + "_" + w[i + 1], w[i] + "_" + w[i + 1] + "_" + w[i + 2]]) { const n = NAT.get(k); if (n) out.add(n); }
  return [...out].slice(0, 6);
}

// one message object at a time: DiscordChatExporter pretty-prints each on lines opening "    {" and closing "    }" / "    },"
async function* messages(file) {
  const rl = readline.createInterface({ input:fs.createReadStream(file, { encoding:"utf8", highWaterMark:1 << 20 }), crlfDelay:Infinity });
  let head = [], inMsgs = false, buf = null;
  for await (const line of rl) {
    if (!inMsgs) { if (line.trim() === '"messages": [') { inMsgs = true; yield { header:JSON.parse(head.join("\n").replace(/,\s*$/, "") + "}") }; } else head.push(line); continue; }
    if (buf === null) { if (line === "    {") buf = ["{"]; else if (/^  \]/.test(line)) break; continue; }
    if (line === "    }" || line === "    },") { buf.push("}"); try { yield JSON.parse(buf.join("\n")); } catch {} buf = null; continue; }
    buf.push(line);
  }
}

const kindOf = (h, file) => /terra-nostra|terra-aurora|minecraft-chat|ingame|in-game/i.test(h.channel.name) ? "bridge"
  : h.channel.type === "GuildNews" || /announce|news|notice|release|お知らせ|press|editorial/i.test(h.channel.name) ? "ann" : "chat";
const shortGuild = g => g.replace(/\s*-\s*Minecraft Earth Server.*$/i, "").replace(/\s*[|_]\s*Terra Nostra.*$/i, "").replace(/\s*\(EMC\)|\s*-\s*EarthMC\s*$/i, "").replace(/[^\p{L}\p{N} ]/gu, "").trim();
const topRole = a => (a.roles || []).slice().sort((x, y) => (y.position || 0) - (x.position || 0))[0]?.name || "";
const BRIDGE_LINE = /^\**\[?([A-Za-z0-9_.]{2,20})\]?\**\s*[:»>]\s?(.*)$/s;

(async () => {
  const NAT = await nations();
  fs.mkdirSync(path.join(OUT, "digest"), { recursive:true });
  const kept = fs.createWriteStream(path.join(OUT, "kept.jsonl"));
  const sources = [];
  const files = fs.readdirSync(IN).filter(f => f.endsWith(".json")).map(f => path.join(IN, f)).sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
  for (const file of files) {
    const t0 = Date.now(); let h = null, kind = "", g = "";
    const src = { file:path.basename(file), mb:+(fs.statSync(file).size / 1048576).toFixed(1), messages:0, inRange:0, kept:0, speakers:new Set(), first:null, last:null, months:{}, nations:{} };
    for await (const m of messages(file)) {
      if (m.header) { h = m.header; kind = kindOf(h, file); g = shortGuild(h.guild.name); Object.assign(src, { guild:h.guild.name, short:g, channel:h.channel.name, kind }); continue; }
      src.messages++;
      const t = Date.parse(m.timestamp); if (!(t >= SINCE)) continue;
      src.inRange++; src.first ??= m.timestamp.slice(0, 10); src.last = m.timestamp.slice(0, 10);
      const mo = m.timestamp.slice(0, 7); src.months[mo] = (src.months[mo] || 0) + 1;
      let author = m.author?.nickname || m.author?.name || "?", text = (m.content || "").trim();
      // the in-game bridge posts "Player: message" from a bot account; joins, deaths and server notices are dropped
      if (kind === "bridge") { const b = text.replace(/^<a?:\w+:\d+>\s*/, "").match(BRIDGE_LINE); if (!b) continue; author = b[1]; text = b[2].trim(); }
      for (const e of m.embeds || []) if (e.description || e.title) text += (text ? "\n" : "") + [e.title, e.description].filter(Boolean).join(": ");
      src.speakers.add(author);
      if (!text || /^(https?:\/\/\S+\s*)+$/.test(text)) continue;
      const nat = named(NAT, text);
      for (const n of nat) src.nations[n] = (src.nations[n] || 0) + 1;
      const strong = (text.match(STRONG) || []).length, weak = (text.match(WEAK) || []).length;
      const rx = (m.reactions || []).reduce((s, r) => s + (r.count || 0), 0);
      const score = kind === "ann" ? 10 : Math.min(strong, 3) * 3 + Math.min(weak, 3) + Math.min(nat.length, 3) * 2 + (text.length >= 80 ? 1 : 0) + Math.min(rx, 6) / 2;
      const keep = kind === "ann" ? text.length >= 15 : text.length >= 25 && strong >= 1 && score >= 6;
      if (!keep) continue;
      src.kept++;
      kept.write(JSON.stringify({ t:m.timestamp.slice(0, 16), g, c:h.channel.name, k:kind, a:author, r:kind === "bridge" ? "" : topRole(m.author || {}), x:text.slice(0, kind === "ann" ? 1500 : 500), s:+score.toFixed(1), n:nat, rx }) + "\n");
    }
    sources.push({ ...src, speakers:src.speakers.size, nations:Object.fromEntries(Object.entries(src.nations).sort((a, b) => b[1] - a[1]).slice(0, 40)) });
    console.log(`${src.short} / ${src.channel} (${src.kind}): ${src.messages.toLocaleString()} messages, ${src.inRange.toLocaleString()} since ${new Date(SINCE).toISOString().slice(0, 10)}, kept ${src.kept.toLocaleString()} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await new Promise(r => kept.end(r));
  fs.writeFileSync(path.join(OUT, "sources.json"), JSON.stringify(sources, null, 1));

  // the readable digest: by month, announcements in full, chat ranked by score and capped per day and channel
  const all = fs.readFileSync(path.join(OUT, "kept.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const byDay = new Map();
  for (const m of all) { const k = m.t.slice(0, 10) + "|" + m.g + "|" + m.c; byDay.set(k, [...(byDay.get(k) || []), m]); }
  const chosen = [];
  for (const [, ms] of byDay) { const k = ms[0].k; chosen.push(...(k === "ann" ? ms : ms.sort((a, b) => b.s - a.s).slice(0, k === "bridge" ? BRIDGE_PER_DAY : CHAT_PER_DAY))); }
  chosen.sort((a, b) => a.t.localeCompare(b.t));
  const months = new Map();
  for (const m of chosen) { const mo = m.t.slice(0, 7); months.set(mo, [...(months.get(mo) || []), m]); }
  for (const [mo, ms] of months) fs.writeFileSync(path.join(OUT, "digest", mo + ".txt"),
    ms.map(m => `${m.t.replace("T", " ")} [${m.g}/${m.c}${m.k === "ann" ? " ANN" : ""}] ${m.a}${m.r ? ` (${m.r})` : ""}: ${m.x.replace(/\s*\n\s*/g, " / ")}`).join("\n") + "\n");
  console.log(`kept ${all.length.toLocaleString()} messages; digest ${chosen.length.toLocaleString()} lines in ${months.size} months -> ${path.join(OUT, "digest")}`);
})();
