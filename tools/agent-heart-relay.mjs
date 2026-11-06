#!/usr/bin/env node
// Agent Heart relay — deterministic collection pass.
//
// Pulls new messages from the collection guild (the one Agent Heart is installed in),
// downloads image attachments, and stages them under intel/inbox/raw for the analyst pass.
// No LLM here: this half must be reproducible and cheap. The analyst pass (Hermes/Claude)
// reads the staged files, OCRs the images, decides what is worth keeping, and writes
// intel/inbox/items/*.json.
//
//   node tools/agent-heart-relay.mjs [--out DIR] [--guild ID] [--dry] [--backfill N]
//
// Token: DISCORD_BOT_TOKEN in the environment (Hermes .env) unless --token-file is given.
// Nothing here ever prints the token.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const API = "https://discord.com/api/v10";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO = path.resolve(HERE, "..");

const arg = (k, d = null) => {
  const i = process.argv.indexOf("--" + k);
  return i >= 0 ? (process.argv[i + 1]?.startsWith("--") ? true : process.argv[i + 1]) : d;
};
const flag = k => process.argv.includes("--" + k);

const OUT = path.resolve(arg("out", path.join(REPO, "intel")));
const RAW = path.join(OUT, "inbox", "raw");
const ATT = path.join(OUT, "attachments");
const STATE = path.join(OUT, "state.json");
const GUILD = arg("guild", process.env.AH_GUILD || "1567139487673487441");
const DRY = flag("dry");
const BACKFILL = +(arg("backfill", 0)) || 0; // 0 = only messages newer than the cursor
// channels that are plumbing rather than intelligence
const EXCLUDE = new Set((process.env.AH_EXCLUDE || "test").split(",").map(s => s.trim()).filter(Boolean));
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MAX_IMAGE = 8 * 1024 * 1024;
const PAGE = 100;

let TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const tokenFile = arg("token-file");
if (!TOKEN && tokenFile) {
  const txt = fs.readFileSync(tokenFile, "utf8");
  const m = /^DISCORD_BOT_TOKEN\s*=\s*(.+)$/m.exec(txt);
  TOKEN = (m ? m[1] : txt).trim().replace(/^["']|["']$/g, "");
}
if (!TOKEN) {
  console.error("No token. Set DISCORD_BOT_TOKEN in the environment, or pass --token-file <path to .env>.");
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(route, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(API + route, { headers: { Authorization: "Bot " + TOKEN, "User-Agent": "BleedingHeartRelay/1.0" } });
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      const wait = Math.ceil((j.retry_after || 1) * 1000) + 250;
      console.warn(`rate limited on ${route}; waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${route} -> ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    return r.json();
  }
  throw new Error(`${route}: gave up after ${tries} tries`);
}

const loadState = () => {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { channels: {}, updated: null }; }
};
const saveState = s => { s.updated = new Date().toISOString(); fs.writeFileSync(STATE, JSON.stringify(s, null, 1) + "\n"); };

// A forwarded announcement (type 12, "channel follow") carries the source server and channel
// in message_reference; the webhook author name is "<source> #<channel>". Prefer the author label.
function sourceOf(m) {
  const ref = m.message_reference || {};
  const label = m.author?.global_name || m.author?.username || "";
  const m2 = /^(.*?)\s+#(.+)$/.exec(label);
  return {
    guild_id: ref.guild_id || m.guild_id || null,
    channel_id: ref.channel_id || m.channel_id || null,
    label: m2 ? m2[1].trim() : label,
    channel: m2 ? m2[2].trim() : null,
  };
}
const isForward = m => m.type === 12 || !!m.message_reference?.guild_id;
// Discord posts a system notice in the destination channel when a channel is followed
// ("Kingdom of Sumer #announcements"). It is plumbing, not intelligence: the author is the
// human who followed it, not a webhook. Real relayed content always arrives by webhook.
const isFollowNotice = m => isForward(m) && !m.webhook_id && !m.author?.bot;
const textOf = m => {
  const parts = [m.content || ""];
  for (const e of m.embeds || []) parts.push(e.title, e.description, ...(e.fields || []).map(f => `${f.name}: ${f.value}`));
  return parts.filter(Boolean).join("\n").replace(/<a?:(\w+):\d+>/g, ":$1:").replace(/\n{3,}/g, "\n\n").trim();
};

async function download(att, messageId) {
  const name = `${messageId}-${att.filename.replace(/[^\w.\-]+/g, "_")}`;
  const dest = path.join(ATT, name);
  if (fs.existsSync(dest)) return name;
  if ((att.size || 0) > MAX_IMAGE) { console.warn(`  skip ${att.filename}: ${(att.size / 1048576).toFixed(1)}MB > cap`); return null; }
  const r = await fetch(att.url);
  if (!r.ok) { console.warn(`  attachment fetch failed: ${att.filename} (${r.status})`); return null; }
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return name;
}

async function main() {
  if (!DRY) { fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(ATT, { recursive: true }); }
  const state = loadState();

  const guild = await api(`/guilds/${GUILD}`);
  if (!guild) throw new Error(`Agent Heart is not in guild ${GUILD} (404).`);
  const channels = (await api(`/guilds/${GUILD}/channels`) || [])
    .filter(c => (c.type === 0 || c.type === 5) && !EXCLUDE.has(c.name))
    .sort((a, b) => a.position - b.position);

  console.log(`Agent Heart @ ${guild.name} (${GUILD}) — ${channels.length} channels to read`);
  const staged = [];
  const follows = {};
  let downloaded = 0;

  for (const ch of channels) {
    let cursor = state.channels[ch.id] || null;
    if (!cursor && BACKFILL) cursor = null;
    let fetched = 0, kept = 0, newest = cursor;

    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (cursor) q.set("after", cursor);
      let msgs = await api(`/channels/${ch.id}/messages?${q}`);
      if (!msgs || !msgs.length) break;
      msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      if (BACKFILL && !cursor && page === 0) msgs = msgs.slice(-BACKFILL);

      for (const m of msgs) {
        fetched++;
        const text = textOf(m);
        const images = (m.attachments || []).filter(a => IMAGE.test(a.filename) || /^image\//.test(a.content_type || ""));
        if (!text && !images.length) continue;

        const src = sourceOf(m);
        const kind = isFollowNotice(m) ? "follow_notice" : "content";
        const rec = {
          message_id: m.id,
          kind,
          channel: { id: ch.id, name: ch.name, type: ch.type },
          captured_at: new Date().toISOString(),
          posted_at: m.timestamp,
          forwarded: isForward(m),
          source: src,
          author: { id: m.author?.id || null, name: m.author?.global_name || m.author?.username || "?", bot: !!m.author?.bot, webhook: !!m.webhook_id },
          text,
          url: `https://discord.com/channels/${GUILD}/${ch.id}/${m.id}`,
          attachments: [],
          reactions: (m.reactions || []).reduce((s, r) => s + (r.count || 0), 0),
        };
        // the follow notices collectively describe which channels are being mirrored: a register.
        // For a notice the source is written in the message text ("Kingdom of Sumer #announcements"),
        // not in the author name, so parse it from there.
        if (kind === "follow_notice") {
          const parsed = /^(.*?)\s+#(\S.*)$/.exec(text.trim());
          const label = (parsed ? parsed[1] : text).trim();
          const chan = parsed ? parsed[2].trim() : null;
          const key = `${label} #${chan}`;
          follows[key] = { label, channel: chan, guild_id: src.guild_id, channel_id: src.channel_id, relayed_via: `#${ch.name}`, first_seen: follows[key]?.first_seen || m.timestamp, notice_id: m.id };
        }
        for (const a of images) {
          if (DRY) { rec.attachments.push({ filename: a.filename, size: a.size, url: a.url, saved: null }); continue; }
          const saved = await download(a, m.id);
          if (saved) { downloaded++; rec.attachments.push({ filename: a.filename, size: a.size, url: a.url, saved: `intel/attachments/${saved}` }); }
        }
        if (!rec.attachments.length && !text) continue;
        // only real content is staged for analysis; follow notices become the register instead
        if (kind === "content") {
          if (!DRY) fs.writeFileSync(path.join(RAW, `${m.id}.json`), JSON.stringify(rec, null, 1) + "\n");
          staged.push({ id: m.id, channel: ch.name, from: src.label, images: rec.attachments.length, text: text.slice(0, 90) });
          kept++;
        }
        if (!newest || BigInt(m.id) > BigInt(newest)) newest = m.id;
      }
      if (msgs.length < PAGE) break;
      cursor = msgs[msgs.length - 1].id;
    }
    if (!DRY && newest && newest !== state.channels[ch.id]) state.channels[ch.id] = newest;
    console.log(`  #${ch.name}: fetched ${fetched}, staged ${kept}${newest && newest !== (state.channels[ch.id] || null) ? ` (cursor -> ${newest})` : ""}`);
  }

  if (!DRY) saveState(state);
  // the follow register accumulates across runs, so merge rather than overwrite
  if (!DRY && Object.keys(follows).length) {
    const FILE = path.join(OUT, "follows.json");
    let old = {};
    try { old = JSON.parse(fs.readFileSync(FILE, "utf8")).follows || {}; } catch {}
    const merged = { ...old };
    for (const [k, v] of Object.entries(follows)) merged[k] = { ...(old[k] || {}), ...v };
    fs.writeFileSync(FILE, JSON.stringify({ updated: new Date().toISOString(), count: Object.keys(merged).length, follows: Object.fromEntries(Object.entries(merged).sort((a, b) => a[0].localeCompare(b[0]))) }, null, 1) + "\n");
    console.log(`follow register: ${Object.keys(merged).length} channel(s) mirrored -> intel/follows.json`);
  }
  console.log(`\n${staged.length} message(s) staged, ${downloaded} image(s) downloaded${DRY ? " [dry run]" : ""}`);
  if (staged.length) console.log(`raw -> ${path.relative(REPO, RAW)}`);
  for (const s of staged) console.log(`  ${s.id} [#${s.channel}] ${s.from}${s.images ? ` [${s.images} img]` : ""} ${s.text}`);
}

main().catch(e => { console.error("relay failed:", e.message); process.exit(1); });
