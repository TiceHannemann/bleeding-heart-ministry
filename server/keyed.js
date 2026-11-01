// What an EarthMC API key adds. A key is made in game with `/api key create` and belongs to one player; it is read
// from the EMC_KEY setting, stays on the server and never reaches a browser or the archive. With it the Ministry reads:
//   - the mcMMO leaderboards: the top 25 in every skill and in overall power, one board every two minutes
//   - the pursuits: the server's running competitions for players, towns and nations
//   - the event stream: the new day as it happens (a scan follows, so fresh ruins show within minutes), and the
//     key owner's own shop trades and town and nation changes (EarthMC sends those to the owner only)
//   - with EMC_PLAYER (the key owner's name): their shops, their skills, and the bank history of the town and nation they run
// The result goes to the page as meta "keyed".
const fs = require("fs");
const path = require("path");
const { DATA, readJSON, writeJSON } = require("./paths");

const DIR = path.join(DATA, "keyed");
fs.mkdirSync(DIR, { recursive:true });
const STATE = path.join(DIR, "state.json");
const API = (process.env.EMC_API || "https://api.earthmc.net/v4").replace(/\/+$/, "");
const KEY = (process.env.EMC_KEY || "").trim(), ME = (process.env.EMC_PLAYER || "").trim();
const EVERY = Math.max(1, +process.env.KEYED_EVERY || 125) * 1000; // between leaderboard reads; EarthMC allows one every two minutes
const DAY = 864e5;

const COMBAT = ["SWORDS", "AXES", "ARCHERY", "CROSSBOWS", "MACES", "SPEARS", "TRIDENTS", "UNARMED", "ACROBATICS", "TAMING"];
const CRAFT = ["MINING", "WOODCUTTING", "HERBALISM", "EXCAVATION", "FISHING", "SMELTING", "ALCHEMY", "REPAIR", "SALVAGE"];
const BOARDS = ["power", ...COMBAT, ...CRAFT];
const SHOP_EV = { ShopSoldItem:"sold", ShopBoughtItem:"bought", ShopOutOfStock:"out_of_stock", ShopOutOfSpace:"out_of_space", ShopOutOfGold:"out_of_gold" };
const EVENTS = ["NewDay", "NationCreated", "NationDeleted", "NationRenamed", "NationKingChanged", "NationMerged", "TownCreated", "TownDeleted", "TownRenamed",
  "TownMayorChanged", "TownMerged", "TownRuined", "TownReclaimed", "TownJoinedNation", "TownLeftNation", "ResidentJoinedTown", "ResidentLeftTown", ...Object.keys(SHOP_EV)];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const asList = d => Array.isArray(d) ? d : d && typeof d === "object" ? [d] : [];
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(s));
const ms = t => t == null ? null : t < 1e12 ? t * 1000 : t; // the API gives unix seconds
const msg = e => String(e?.message || e).slice(0, 200);

const state = Object.assign({ boards:{}, next:0, pursuits:null, who:{}, names:{}, newDayAt:null, me:null, meAt:0, shops:null, bank:null, trades:[], notices:[], errs:{} }, readJSON(STATE) || {});
const save = () => {
  const now = Date.now();
  state.trades = state.trades.filter(t => t.at > now - 30 * DAY).slice(-2000);
  state.notices = state.notices.filter(t => t.at > now - 14 * DAY).slice(-300);
  for (const m of [state.who, state.names]) for (const [k, v] of Object.entries(m)) if (v[2] < now - 7 * DAY) delete m[k];
  writeJSON(STATE, state);
};

/* ---------- requests ---------- */
// The key travels in the request body (or the event stream's header) and is never put in an error message.
async function call(p, body) {
  const r = await fetch(API + p, { method:body ? "POST" : "GET", headers:{ "Content-Type":"application/json", "User-Agent":"BleedingHeart-Ministry" },
    body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(30e3) });
  const t = await r.text();
  if (r.status === 429) { const e = new Error(`${p} is cooling down`); e.wait = (+(t.match(/(\d+)\s*second/) || [])[1] || 60) * 1000; throw e; }
  if (!r.ok) { const e = new Error(`${p} answered HTTP ${r.status}${t.length < 160 ? ": " + t : ""}`); e.status = r.status; throw e; }
  try { return JSON.parse(t); } catch { return t; }
}
// a query of names the API doesn't know comes back as an error, so a failed batch is retried name by name
async function lookup(kind, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const q = ids.slice(i, i + 100);
    try { out.push(...asList(await call("/" + kind, { query:q }))); }
    catch (e) { if (e.wait || q.length === 1) throw e; for (const one of q) try { out.push(...asList(await call("/" + kind, { query:[one] }))); } catch {} }
  }
  return out;
}
// where each ranked player lives: name -> [town, nation, when looked up], refreshed daily
async function placePlayers(names) {
  const now = Date.now(), want = [...new Set(names)].filter(n => n && !(state.who[n] && now - state.who[n][2] < DAY));
  if (!want.length) return;
  for (const n of want) state.who[n] = [null, null, now]; // players the API no longer knows stay unplaced until tomorrow
  for (const p of await lookup("players", want)) if (p?.name) state.who[p.name] = [p.town?.name || null, p.nation?.name || null, now];
}
// the pursuits boards give UUIDs: uuid -> [name, nation, when]
async function nameIds(kind, ids) {
  const now = Date.now(), want = [...new Set(ids)].filter(id => isUuid(id) && !(state.names[id] && now - state.names[id][2] < DAY));
  if (!want.length) return;
  for (const x of await lookup(kind, want)) if (x?.uuid) state.names[x.uuid] = [x.name, kind === "nations" ? x.name : x.nation?.name || null, now];
}

/* ---------- leaderboards ---------- */
async function pollBoard() {
  const skill = BOARDS[state.next % BOARDS.length];
  const j = asList(await call("/mcmmo-top", { query:skill, key:KEY }))[0] || {};
  const top = Object.keys(j).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b).map(k => [j[k]?.player, +j[k]?.level || 0]).filter(r => r[0]);
  const old = state.boards[skill], upd = ms(j.lastUpdated) || Date.now();
  // ranks from the previous leaderboard, so climbers and newcomers can be marked
  const prev = old?.top?.length && old.upd !== upd ? Object.fromEntries(old.top.map(([n], i) => [n, i + 1])) : old?.prev || null;
  state.boards[skill] = { at:Date.now(), upd, top, prev };
  state.next++;
  await placePlayers(top.map(r => r[0])).catch(() => {});
}
async function pollPursuits() {
  let j;
  try { j = asList(await call("/pursuits", { query:"ALL", key:KEY }))[0] || {}; }
  catch (e) { if (e.status === 404) { state.pursuits = { at:Date.now(), none:true }; return; } throw e; }
  const out = { at:Date.now() };
  for (const [K, kind, field] of [["PLAYER", "players", "player"], ["TOWN", "towns", "town"], ["NATION", "nations", "nation"]]) {
    const b = j[K]; if (!b) continue;
    const top = Object.keys(b.top || {}).filter(k => /^\d+$/.test(k)).sort((x, y) => x - y).map(k => [b.top[k]?.[field], +b.top[k]?.score || 0]).filter(r => r[0]);
    await nameIds(kind, top.map(r => r[0])).catch(() => {});
    out[K] = { name:b.name || "", active:b.isActive !== false, top:top.map(([id, s]) => { const n = state.names[id]; return [n?.[0] || id, s, n?.[1] ?? null]; }) };
  }
  state.pursuits = out;
}

/* ---------- the key owner's own: shops, skills, and the books of the town and nation they run ---------- */
const shopRow = s => ({ item:s?.item || "?", type:s?.type || null, price:+s?.price || 0, amount:+s?.amount || 0, stock:s?.stock ?? null, x:s?.location?.x ?? null, y:s?.location?.y ?? null, z:s?.location?.z ?? null });
// bank history comes as a list (or an object keyed "0", "1"...); its fields aren't documented, so they are read loosely
function ledger(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  const pick = (o, re, type) => { for (const k of Object.keys(o)) if (re.test(k) && typeof o[k] === type) return o[k]; return null; };
  return list.slice(-300).map(e => {
    if (!e || typeof e !== "object") return { at:null, amt:null, bal:null, what:String(e) };
    const what = pick(e, /^(reason|type|description|message|action|text|cause|note)$/i, "string") || Object.values(e).filter(v => typeof v === "string").join(" · ");
    return { at:ms(pick(e, /^(timestamp|time|date|at|when)$/i, "number")), amt:pick(e, /^(amount|change|delta|value|sum)$/i, "number"), bal:pick(e, /balance|after|total/i, "number"), what:what || null };
  });
}
async function pollMe() {
  state.meAt = Date.now();
  const p = asList(await call("/players", { query:[ME], key:KEY }))[0];
  if (!p?.uuid) throw new Error(`${ME} was not found on the server`);
  const me = state.me = { ...(state.me || {}), name:p.name, uuid:p.uuid, town:p.town?.name || null, nation:p.nation?.name || null, at:Date.now() };
  const errs = [];
  // the API allows one shop request an hour, and one mcMMO request an hour
  if (!state.shops || Date.now() - state.shops.at > 65 * 6e4) {
    try { state.shops = { at:Date.now(), list:asList(await call("/shop", { query:[p.uuid], key:KEY })).flatMap(o => Object.values(o || {})).filter(s => s && typeof s === "object").map(shopRow) }; }
    catch (e) { if (!e.wait) errs.push(msg(e)); }
  }
  if (!me.skillsAt || Date.now() - me.skillsAt > 6 * 36e5) {
    try { const s = asList(await call("/mcmmo", { query:p.uuid, key:KEY }))[0]; if (s) me.skills = Object.fromEntries(Object.entries(s).filter(([k, v]) => k !== "name" && typeof v === "number")); me.skillsAt = Date.now(); }
    catch (e) { if (!e.wait) { errs.push(msg(e)); me.skillsAt = Date.now(); } }
  }
  // bank history is filled only for a town or nation the key owner leads or keeps the books of
  const bank = { at:Date.now() };
  for (const [k, kind, name] of [["town", "towns", me.town], ["nation", "nations", me.nation]]) if (name) {
    try { const x = asList(await call("/" + kind, { query:[name], key:KEY }))[0]; bank[k] = { name, bal:x?.stats?.balance ?? null, entries:ledger(x?.bankhistory) }; }
    catch (e) { errs.push(msg(e)); }
  }
  state.bank = bank;
  if (errs.length) throw new Error(errs.join("; "));
}

/* ---------- the event stream ---------- */
const sse = { on:false, since:null, err:null, events:0, ac:null };
const N = x => x?.name || "?";
const NOTICE = {
  ResidentJoinedTown:d => `${N(d.resident)} joined ${N(d.town)}`, ResidentLeftTown:d => `${N(d.resident)} left ${N(d.town)}`,
  TownJoinedNation:d => `${N(d.town)} joined ${N(d.nation)}`, TownLeftNation:d => `${N(d.town)} left ${N(d.nation)}`,
  TownCreated:d => `${N(d.town)} was founded`, TownDeleted:d => `${N(d.town)} was deleted`, TownRenamed:d => `${d.oldName || "?"} is now ${N(d.town)}`,
  TownMayorChanged:d => `${N(d.newMayor)} became mayor of ${N(d.town)}`, TownMerged:d => `${N(d.oldTown)} merged into ${N(d.remainingTown)}`,
  TownRuined:d => `${N(d.town)} fell to ruin`, TownReclaimed:d => `${N(d.newMayor)} reclaimed ${N(d.town)}`,
  NationCreated:d => `${N(d.nation)} was founded`, NationDeleted:d => `${N(d.nation)} was disbanded`, NationRenamed:d => `${d.oldName || "?"} is now ${N(d.nation)}`,
  NationKingChanged:d => `${N(d.newKing)} now leads ${N(d.nation)}`, NationMerged:d => `${N(d.oldNation)} merged into ${N(d.remainingNation)}`,
};
function onEvent(kind, data) {
  if (!EVENTS.includes(kind)) { if (kind === "error" || kind === "close") sse.err = String(data).slice(0, 200); return; }
  let d; try { d = JSON.parse(data); } catch { return; }
  const at = ms(d.timestamp) || Date.now();
  sse.events++;
  if (kind === "NewDay") { state.newDayAt = at; save(); try { hooks.onNewDay?.(at); } catch {} return; }
  if (SHOP_EV[kind]) {
    const s = d.shop || {};
    state.trades.push({ at, k:SHOP_EV[kind], item:s.item || null, type:s.type || null, price:+s.price || 0, amount:+s.amount || 0, stock:s.stock ?? null,
      who:d.buyer || d.seller || null, x:s.location?.x ?? null, z:s.location?.z ?? null });
  } else state.notices.push({ at, k:kind, t:NOTICE[kind]?.(d) || kind });
  save();
}
async function listen() {
  let wait = 5e3;
  while (!stopped) {
    const ac = sse.ac = new AbortController(); let heard = Date.now();
    const dog = setInterval(() => { if (Date.now() - heard > 3 * 6e4) ac.abort(); }, 3e4); // the stream sends keepalives; silence means it's gone
    try {
      const r = await fetch(API + "/events?listen=" + EVENTS.join(","), { headers:{ Authorization:"Bearer " + KEY, Accept:"text/event-stream", "User-Agent":"BleedingHeart-Ministry" }, signal:ac.signal });
      if (!r.ok) throw new Error(`event stream answered HTTP ${r.status}`);
      Object.assign(sse, { on:true, since:Date.now(), err:null }); wait = 5e3;
      const dec = new TextDecoder(); let buf = "", ev = "", data = "";
      for await (const chunk of r.body) {
        heard = Date.now(); buf += dec.decode(chunk, { stream:true });
        for (let i; (i = buf.indexOf("\n")) >= 0;) {
          const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
          if (!line) { if (ev || data) onEvent(ev || "message", data); ev = data = ""; }
          else if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
        }
      }
      throw new Error("event stream closed");
    } catch (e) { sse.on = false; if (!stopped) sse.err = e.name === "AbortError" ? "event stream went quiet" : msg(e); }
    finally { clearInterval(dog); }
    if (!stopped) await sleep(wait);
    wait = Math.min(5 * 6e4, wait * 2);
  }
}

/* ---------- schedule ---------- */
let hooks = {}, timer = 0, stopped = false;
function start(o) {
  hooks = o || {};
  if (!KEY) return;
  listen();
  timer = setTimeout(loop, 20e3);
}
async function loop() {
  if (stopped) return;
  let wait = EVERY;
  if (hooks.busy?.()) wait = 30e3; // stay out of the way of the hourly scan and the finance scan
  else {
    try { await pollBoard(); state.errs.boards = null; } catch (e) { if (e.wait) wait = e.wait + 3e3; else state.errs.boards = msg(e); }
    if (Date.now() - (state.pursuits?.at || 0) > 10 * 6e4) try { await pollPursuits(); state.errs.pursuits = null; } catch (e) { if (!e.wait) state.errs.pursuits = msg(e); }
    if (ME && Date.now() - state.meAt > 36e5) try { await pollMe(); state.errs.me = null; } catch (e) { state.errs.me = msg(e); }
    save();
  }
  timer = setTimeout(loop, wait);
}
function stop() { stopped = true; clearTimeout(timer); sse.ac?.abort(); }

// what the page gets: every ranked player with where they live, and nothing of the key
function snapshot() {
  if (!KEY) return null;
  const who = n => state.who[n] || [];
  const boards = Object.fromEntries(Object.entries(state.boards).map(([k, b]) => [k, { at:b.at, upd:b.upd,
    top:b.top.map(([n, lv]) => [n, lv, who(n)[1] || null, who(n)[0] || null, b.prev ? b.prev[n] || 0 : null]) }])); // [player, level, nation, town, previous rank (0: new)]
  const me = state.me ? { name:state.me.name, town:state.me.town, nation:state.me.nation, skills:state.me.skills || null } : null;
  return { at:Date.now(), boards, pursuits:state.pursuits, newDayAt:state.newDayAt, live:sse.on, me, shops:me ? state.shops : null, bank:me ? state.bank : null,
    trades:state.trades.filter(t => t.at > Date.now() - 30 * DAY), notices:state.notices.slice(-100) };
}
const status = () => ({ on:!!KEY, player:ME || null, boards:Object.keys(state.boards).length, pursuits:state.pursuits?.at || null, live:sse.on, liveSince:sse.since,
  liveErr:sse.err, events:sse.events, newDayAt:state.newDayAt, errs:state.errs });

module.exports = { start, stop, snapshot, status, pollBoard, pollPursuits, pollMe, ledger, BOARDS, COMBAT, CRAFT, _state:state };
