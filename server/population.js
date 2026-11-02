// Ministry of Population: who joins the server, who is still without a town, and who moves between nations.
// It is fed by the Finance ministry's player scan (every player's full record, every few hours), so it costs no
// extra requests. Each scan is compared with the last one: a player whose nation changed is a move. From the
// records alone (before any history builds up) it also knows when each player first joined the server and when
// they joined their present town. The result goes to the page as meta "population".
const fs = require("fs");
const path = require("path");
const { DATA, readJSON, writeJSON } = require("./paths");

const DIR = path.join(DATA, "population");
fs.mkdirSync(DIR, { recursive:true });
const STATE = path.join(DIR, "state.json");
const DAY = 864e5;
const KEEP_MOVES = 45 * DAY, MAX_MOVES = 8000;

// last: name -> [nation, town] at the previous scan; moves: [player, from nation, to nation, from town, to town, at]
const state = Object.assign({ at:null, first:null, last:{}, moves:[], snap:null }, readJSON(STATE) || {});
const save = () => writeJSON(STATE, state);
const nationOf = name => state.last[name]?.[0] ?? null;
const townOf = name => state.last[name]?.[1] ?? null;

// recs: [{ n, reg, last, town, nation, joined, bal }] from the player scan; prev: an older scan to compare with the
// first time this runs ({ at, players:{ name:[balance, town, nation] } }), so moves show from the start
function ingest(recs, at, prev) {
  if (!state.at && prev?.players) {
    state.last = Object.fromEntries(Object.entries(prev.players).map(([n, v]) => [n, [v[2] || null, v[1] || null]]));
    state.at = prev.at; state.first = prev.at;
  }
  const had = !!state.at, next = {};
  for (const r of recs) {
    next[r.n] = [r.nation || null, r.town || null];
    const o = state.last[r.n];
    if (!had) continue;
    // a new account counts as a move only when it already belongs to a nation
    if (!o) { if (r.nation && r.reg && r.reg > state.at - DAY) state.moves.push([r.n, null, r.nation, null, r.town || null, at]); continue; }
    if (o[0] !== (r.nation || null)) state.moves.push([r.n, o[0], r.nation || null, o[1], r.town || null, at]);
  }
  state.moves = state.moves.filter(m => m[5] > at - KEEP_MOVES).slice(-MAX_MOVES);
  state.last = next; state.at = at; state.first = state.first || at;
  state.snap = summarise(recs, at);
  save();
  return { players:recs.length, moves:state.moves.filter(m => m[5] === at).length };
}

function summarise(recs, at) {
  const day0 = Math.floor(at / DAY) * DAY, active = r => r.last && r.last > at - 7 * DAY;
  // new accounts per day for the last 30 days, and how many of each day's arrivals are still without a town
  const daily = Array.from({ length:30 }, (_, i) => [day0 - (29 - i) * DAY, 0, 0]);
  for (const r of recs) { if (!r.reg || r.reg < day0 - 29 * DAY) continue; const d = daily[Math.floor((r.reg - (day0 - 29 * DAY)) / DAY)]; if (d) { d[1]++; if (!r.town) d[2]++; } }
  const row = r => [r.n, r.reg || null, r.last || null, r.town || null, r.nation || null, Math.round(r.bal || 0)];
  const newcomers = recs.filter(r => r.reg && r.reg > at - 14 * DAY).sort((a, b) => b.reg - a.reg);
  const townless = recs.filter(r => !r.town && active(r)).sort((a, b) => b.last - a.last);
  // each nation: members, active members, and members who joined their present town in the last week or month
  const N = new Map(), nat = n => N.get(n) || N.set(n, { n, members:0, active:0, j7:0, j30:0, fresh:0 }).get(n);
  for (const r of recs) {
    if (!r.nation) continue;
    const x = nat(r.nation); x.members++; if (active(r)) x.active++;
    if (r.joined > at - 7 * DAY) x.j7++; if (r.joined > at - 30 * DAY) x.j30++;
    if (r.reg > at - 14 * DAY) x.fresh++;
  }
  // moves between nations: in, out, from no nation, to no nation, over the last week
  for (const m of state.moves) {
    if (m[5] < at - 7 * DAY) continue;
    if (m[1]) { const x = nat(m[1]); x.out = (x.out || 0) + 1; if (!m[2]) x.toNone = (x.toNone || 0) + 1; }
    if (m[2]) { const x = nat(m[2]); x.in = (x.in || 0) + 1; if (!m[1]) x.fromNone = (x.fromNone || 0) + 1; }
  }
  const nations = [...N.values()].map(x => ({ ...x, in:x.in || 0, out:x.out || 0, fromNone:x.fromNone || 0, toNone:x.toNone || 0, net:(x.in || 0) - (x.out || 0) }))
    .sort((a, b) => b.members - a.members);
  const corr = new Map();
  for (const m of state.moves) if (m[1] && m[2] && m[5] > at - 30 * DAY) { const k = m[1] + "→" + m[2], e = corr.get(k) || [m[1], m[2], 0, 0]; e[2]++; e[3] = Math.max(e[3], m[5]); corr.set(k, e); }
  return {
    at, since:state.first,
    totals:{ players:recs.length, active7:recs.filter(active).length, townless:recs.filter(r => !r.town).length, townlessActive:townless.length,
      new7:recs.filter(r => r.reg > at - 7 * DAY).length, new30:recs.filter(r => r.reg > at - 30 * DAY).length,
      newTownless7:recs.filter(r => r.reg > at - 7 * DAY && !r.town).length },
    daily, newcomers:newcomers.slice(0, 250).map(row), townless:townless.slice(0, 400).map(row), nations,
    moves:state.moves.filter(m => m[5] > at - 7 * DAY).slice(-500).reverse(),
    corridors:[...corr.values()].sort((a, b) => b[2] - a[2]).slice(0, 40),
  };
}

const snapshot = () => state.snap;
const status = () => ({ at:state.at, since:state.first, moves:state.moves.length, players:Object.keys(state.last).length });
module.exports = { ingest, snapshot, status, nationOf, townOf, _state:state };
