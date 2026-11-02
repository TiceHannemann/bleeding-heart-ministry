// Who kills whom. EarthMC's in-game chat bridge posts every player kill to Discord as "☠ Victim was killed by Killer".
// Kills arrive from Discord exports: tools/discord-kills.js reads exports of any size on your own computer and sends the
// kills here, and any chat export uploaded for the briefings is searched for them too. Each kill keeps its time, killer
// and victim. Nations are each player's nation at the latest player scan (server/population.js), which for old kills
// may not be the nation they fought for then.
// From the kills it reads the bigger picture: which nations are fighting each other and how (a war, a skirmish, a raid,
// one side hunting the other, or just two players' feud), and which players are hunters (many victims across many nations), feuding (the same
// victim again and again) or simply fighters. The result goes to the page as meta "combat".
const fs = require("fs");
const path = require("path");
const { DATA, readJSON, writeJSON } = require("./paths");
const { parseDeath, NAME } = require("./deaths");

const DIR = path.join(DATA, "combat");
fs.mkdirSync(DIR, { recursive:true });
const STATE = path.join(DIR, "kills.json");
const DAY = 864e5;
const MAX_KILLS = 60000;

// kills: [at, killer, victim, id]
const state = Object.assign({ kills:[] }, readJSON(STATE) || {});
const save = () => writeJSON(STATE, state);
const keyOf = k => k[3] || `${k[0]}|${k[1]}|${k[2]}`;
let seen = new Set(state.kills.map(keyOf));
// a DiscordChatExporter export (already parsed): the kills in it
function fromExport(j) {
  const out = [];
  for (const m of j?.messages || []) {
    const at = Date.parse(m.timestamp); if (!at) continue;
    for (const t of [m.content, ...(m.embeds || []).flatMap(e => [e.author?.name, e.title, e.description])]) {
      const kv = parseDeath(t); if (kv) { out.push([at, kv[0], kv[1], m.id]); break; }
    }
  }
  return out;
}
function add(list) {
  let added = 0;
  for (const k of list || []) {
    if (!Array.isArray(k) || !(k[0] > 0) || !NAME.test(k[1] || "") || !NAME.test(k[2] || "")) continue;
    const row = [+k[0], k[1], k[2], k[3] ? String(k[3]) : null], key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key); state.kills.push(row); added++;
  }
  if (added) {
    state.kills.sort((a, b) => a[0] - b[0]);
    if (state.kills.length > MAX_KILLS) { state.kills = state.kills.slice(-MAX_KILLS); seen = new Set(state.kills.map(keyOf)); }
    save();
  }
  return { added, total:state.kills.length };
}

// ---- the picture ----
// what kind of fighting a pair of nations is doing, from the kills between them
function kindOf(c) {
  const tot = c.ab + c.ba, side = Math.max(c.ab, c.ba) / Math.max(1, tot), killers = c.ab >= c.ba ? c.kA.size : c.kB.size;
  // most of the kills between one pair of players: their feud (or kill trading), not their nations' fight
  if (tot >= 6 && Math.max(...c.pairs.values()) / tot >= 0.6) return "feud";
  if (tot >= 20 && side <= 0.75 && c.days.size >= 3 && c.kA.size >= 3 && c.kB.size >= 3) return "war";
  if (side >= 0.8 && killers <= 2 && tot >= 4) return "hunting";
  if (side >= 0.8 && killers >= 3 && c.peak >= 4) return "raid";
  if (tot >= 3) return "skirmish";
  return "incident";
}
function snapshot(nationOf = () => null) {
  const K = state.kills; if (!K.length) return null;
  const at = Date.now(), last = K[K.length - 1][0];
  // the window is the last 30 days when there has been fighting in it, otherwise the 30 days before the latest kill on record
  const end = last > at - 30 * DAY ? at : last, from = end - 30 * DAY;
  const W = K.filter(k => k[0] > from && k[0] <= end);
  const P = new Map(), pl = n => P.get(n) || P.set(n, { p:n, nation:nationOf(n), kills:0, deaths:0, victims:new Map(), vn:new Set(), last:0, hours:new Array(24).fill(0) }).get(n);
  const N = new Map(), na = n => N.get(n) || N.set(n, { n, kills:0, deaths:0, killers:new Set(), dead:new Set() }).get(n);
  const C = new Map(), daily = new Map(), hours = new Array(24).fill(0);
  for (const [t, k, v] of W) {
    const a = pl(k), b = pl(v), kn = a.nation, vn = b.nation, h = new Date(t).getUTCHours(), d = Math.floor(t / DAY) * DAY;
    a.kills++; a.last = Math.max(a.last, t); a.victims.set(v, (a.victims.get(v) || 0) + 1); if (vn) a.vn.add(vn); a.hours[h]++;
    b.deaths++; hours[h]++; daily.set(d, (daily.get(d) || 0) + 1);
    if (kn) { const x = na(kn); x.kills++; x.killers.add(k); }
    if (vn) { const x = na(vn); x.deaths++; x.dead.add(v); }
    if (kn && vn && kn !== vn) {
      const [A, B] = [kn, vn].sort(), key = A + "|" + B;
      const c = C.get(key) || C.set(key, { A, B, ab:0, ba:0, kA:new Set(), kB:new Set(), first:t, last:t, days:new Set(), byDay:new Map(), peak:0, pairs:new Map() }).get(key);
      if (kn === A) { c.ab++; c.kA.add(k); } else { c.ba++; c.kB.add(k); }
      const pk = [k, v].sort().join("|"); c.pairs.set(pk, (c.pairs.get(pk) || 0) + 1);
      c.last = Math.max(c.last, t); c.first = Math.min(c.first, t); c.days.add(d);
      c.byDay.set(d, (c.byDay.get(d) || 0) + 1); c.peak = Math.max(c.peak, c.byDay.get(d));
    }
  }
  // players: hunters take many victims across many nations; feuding is the same victim again and again
  const roleOf = x => {
    const top = Math.max(0, ...x.victims.values());
    if (x.victims.size >= 8 && x.vn.size >= 4 && x.kills >= 2 * Math.max(1, x.deaths)) return "hunter";
    if (top >= 5 && top >= x.kills * 0.5) return "feud";
    if (x.kills >= 5) return "fighter";
    return null;
  };
  const players = [...P.values()].filter(x => x.kills).map(x => {
    const tv = [...x.victims].sort((a, b) => b[1] - a[1])[0];
    return { p:x.p, nation:x.nation, kills:x.kills, deaths:x.deaths, victims:x.victims.size, nations:x.vn.size, last:x.last, top:tv ? [tv[0], tv[1]] : null, role:roleOf(x), hours:x.hours };
  }).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).slice(0, 120);
  const nations = [...N.values()].map(x => ({ n:x.n, kills:x.kills, deaths:x.deaths, killers:x.killers.size, dead:x.dead.size })).sort((a, b) => b.kills - a.kills).slice(0, 80);
  const days = Array.from({ length:30 }, (_, i) => Math.floor(end / DAY) * DAY - (29 - i) * DAY);
  const conflicts = [...C.values()].map(c => ({ A:c.A, B:c.B, ab:c.ab, ba:c.ba, kA:c.kA.size, kB:c.kB.size, first:c.first, last:c.last, days:c.days.size, peak:c.peak,
    kind:kindOf(c), series:days.map(d => c.byDay.get(d) || 0) })).sort((a, b) => (b.ab + b.ba) - (a.ab + a.ba)).slice(0, 60);
  return {
    at, from, to:end, live:end === at, total:K.length, inWindow:W.length, first:K[0][0], last,
    daily:days.map(d => [d, daily.get(d) || 0]), hours, players, nations, conflicts,
    recent:K.slice(-300).reverse().map(([t, k, v]) => [t, k, nationOf(k), v, nationOf(v)]),
  };
}
const status = () => ({ kills:state.kills.length, last:state.kills.length ? state.kills[state.kills.length - 1][0] : null });
module.exports = { add, fromExport, parseDeath, snapshot, status, _state:state };
