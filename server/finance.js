// Ministry of Finance: the server's economy, from public data only.
// Item prices from shops are private to each shop owner on EarthMC, so this reads what is public:
//   - every town and nation bank, each hour (from the collector's own scan, no extra requests)
//   - every player's balance and every quarter (apartments, plots) with its sale price, every few hours
// From those it builds wealth by nation, the richest players, hour-to-hour movers, money flows
// (one balance falling by the same amount another rises), towns running out of gold, and the property
// market with its steals. The result goes to the page as meta "finance".
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DATA, readJSON, writeJSON } = require("./paths");

const DIR = path.join(DATA, "finance");
fs.mkdirSync(DIR, { recursive:true });
const STATE = path.join(DIR, "state.json");
const API = (process.env.EMC_API || "https://api.earthmc.net/v4").replace(/\/+$/, "");
const DEEP_EVERY = Math.max(1, +process.env.FINANCE_EVERY_HOURS || 3) * 36e5;
const RATE = 150;            // requests per minute, under EarthMC's 180
const MIN_FLOW = 50;         // smallest balance change worth matching into a flow, in gold
const KEEP_SNAPS = 9;        // player snapshots kept (a day at three-hour spacing)
const DAY = 864e5;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = v => Math.round((+v || 0) * 100) / 100;
const asList = d => Array.isArray(d) ? d : d && typeof d === "object" ? (Object.values(d).find(Array.isArray) || []) : [];
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const chunks = (a, n) => Array.from({ length:Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const gzRead = f => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f))); } catch { return null; } };
const gzWrite = (f, v) => { fs.writeFileSync(f + ".tmp", zlib.gzipSync(JSON.stringify(v))); fs.renameSync(f + ".tmp", f); };

const state = Object.assign({ series:{ global:[], nations:{} }, townHourly:[], flows:[], deepAt:null, deepErr:null, snaps:[] }, readJSON(STATE) || {});
const save = () => writeJSON(STATE, state);

/* ---------- requests, paced under the rate limit ---------- */
const sent = [];
async function api(p, body) {
  for (let attempt = 0; ; attempt++) {
    for (;;) { const now = Date.now(); while (sent.length && now - sent[0] > 60e3) sent.shift(); if (sent.length < RATE && now - (sent[sent.length - 1] || 0) >= 60e3 / RATE) break; await sleep(100); }
    sent.push(Date.now());
    try {
      const r = await fetch(API + p, { method:body ? "POST" : "GET", headers:{ "Content-Type":"application/json", "User-Agent":"BleedingHeart-Ministry" },
        body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(30e3) });
      if (!r.ok) throw new Error(`${p} answered HTTP ${r.status}`);
      return asList(await r.json());
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(Math.min(60e3, 4e3 * 2 ** attempt)); // 4s, 8s, 16s... a refused or failed request is retried, never skipped
    }
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length:n }, async () => { while (i < items.length) await fn(items[i++]); })); }

/* ---------- the deep scan: every player's balance and every quarter ---------- */
async function deepScan() {
  const at = Date.now();
  const names = (await api("/players")).map(p => p?.name).filter(Boolean);
  const players = {}; // name -> [balance, town, nation]
  await pool(chunks(names, 100), 3, async q => {
    for (const p of await api("/players", { query:q })) if (p?.name) players[p.name] = [r2(p.stats?.balance), p.town?.name || null, p.nation?.name || null];
  });
  const ids = (await api("/quarters")).map(q => q?.uuid).filter(Boolean);
  const quarters = [];
  await pool(chunks(ids, 100), 3, async q => {
    for (const x of await api("/quarters", { query:q })) {
      if (!x?.uuid) continue;
      const c = (x.cuboids || [])[0], mid = c ? [0, 2].map(k => Math.round((c.cornerOne[k] + c.cornerTwo[k]) / 2)) : null;
      quarters.push({ id:x.uuid, name:x.name || "Quarter", type:x.type || null, town:x.town?.name || null, nation:x.nation?.name || null, owner:x.owner?.name || null,
        sale:!!x.status?.isForSale, price:x.stats?.price ?? null, vol:x.stats?.volume ?? null, x:mid?.[0] ?? null, z:mid?.[1] ?? null });
    }
  });
  // player snapshots live in their own files; the state keeps the list
  const file = `players-${at}.json.gz`;
  gzWrite(path.join(DIR, file), players);
  state.snaps.push({ at, file, n:Object.keys(players).length });
  while (state.snaps.length > KEEP_SNAPS) { const old = state.snaps.shift(); fs.rmSync(path.join(DIR, old.file), { force:true }); }
  // the previous scan's asking prices, so price cuts and new listings can be told apart
  const old = gzRead(path.join(DIR, "quarters.json.gz"));
  const prev = old ? Object.fromEntries(old.quarters.filter(q => q.sale && q.price > 0).map(q => [q.id, q.price])) : null;
  gzWrite(path.join(DIR, "quarters.json.gz"), { at, quarters, prev });
  inferFlows();
  state.deepAt = at; state.deepErr = null; save();
  return { players:Object.keys(players).length, quarters:quarters.length, seconds:Math.round((Date.now() - at) / 1000) };
}

/* ---------- money flows: matched rises and falls between the last two snapshots ---------- */
const townsNear = ts => state.townHourly.reduce((b, s) => !b || Math.abs(s.at - ts) < Math.abs(b.at - ts) ? s : b, null);
function inferFlows() {
  if (state.snaps.length < 2) return;
  const [A, B] = state.snaps.slice(-2), pa = gzRead(path.join(DIR, A.file)) || {}, pb = gzRead(path.join(DIR, B.file)) || {};
  const ta = townsNear(A.at), tb = townsNear(B.at), townOf = {};
  const moves = [];
  for (const [n, v] of Object.entries(pb)) { const o = pa[n]; if (!o) continue; const d = r2(v[0] - o[0]); if (Math.abs(d) >= MIN_FLOW) moves.push({ k:"p", n, d, town:v[1], nation:v[2] }); }
  // town banks between the same two moments, when the hourly record covers both
  if (ta && tb && ta !== tb) for (const [n, v] of Object.entries(tb.b)) { const o = ta.b[n]; if (o == null) continue; const d = r2(v[0] - o[0]); if (Math.abs(d) >= MIN_FLOW) moves.push({ k:"t", n, d, town:n, nation:v[1] }); }
  const byAmt = new Map();
  for (const m of moves) { const key = Math.round(Math.abs(m.d) * 100); byAmt.set(key, [...(byAmt.get(key) || []), m]); }
  const found = [];
  for (const [key, ms] of byAmt) {
    const out = ms.filter(m => m.d < 0), inn = ms.filter(m => m.d > 0);
    if (!out.length || !inn.length || out.length > 3 || inn.length > 3) continue; // a common amount (upkeep, tax) can't be paired with any confidence
    const amt = key / 100, round = amt % 10 === 0;
    const conf = out.length === 1 && inn.length === 1 ? (round ? "moderate" : "high") : "low";
    for (let i = 0; i < Math.min(out.length, inn.length); i++) {
      const a = out[i], b = inn[i];
      if (a.k === "t" && b.k === "t") continue; // town-to-town transfers are rare; a match is more likely two unrelated changes
      found.push({ a:{ k:a.k, n:a.n, town:a.town, nation:a.nation }, b:{ k:b.k, n:b.n, town:b.town, nation:b.nation }, amt, at:B.at, from:A.at, conf });
    }
  }
  state.flows = [...state.flows.filter(f => f.at > Date.now() - 7 * DAY && f.at !== B.at), ...found];
}

/* ---------- each hour: banks from the collector's scan, then the full picture ---------- */
// towns: [[name, nation, bank, forSalePrice, x, z, residents]]; nations: [[name, bank]]
function hourly({ towns, nations }) {
  const at = Date.now();
  state.townHourly.push({ at, b:Object.fromEntries(towns.map(t => [t[0], [r2(t[2]), t[1]]])) });
  state.townHourly = state.townHourly.filter(s => s.at > at - 26 * 36e5);
  const snap = state.snaps.length ? gzRead(path.join(DIR, state.snaps[state.snaps.length - 1].file)) || {} : {};
  const snap24 = state.snaps.find(s => s.at >= at - 25 * 36e5) || null, p24 = snap24 && snap24 !== state.snaps[state.snaps.length - 1] ? gzRead(path.join(DIR, snap24.file)) || {} : null;
  const prevSnap = state.snaps.length > 1 ? gzRead(path.join(DIR, state.snaps[state.snaps.length - 2].file)) || {} : null;
  const qs = gzRead(path.join(DIR, "quarters.json.gz"));

  // wealth by nation: its own bank, its towns' banks, and its members' purses
  const N = new Map(), nat = n => N.get(n) || N.set(n, { n, bank:0, towns:0, players:0, members:0, nTowns:0 }).get(n);
  for (const [n, b] of nations) nat(n).bank = r2(b);
  for (const t of towns) if (t[1]) { const x = nat(t[1]); x.towns = r2(x.towns + t[2]); x.nTowns++; }
  const townWealth = Object.fromEntries(towns.map(t => [t[0], [r2(t[2]), 0]]));
  let playersTotal = 0;
  for (const [name, [bal, town, nation]] of Object.entries(snap)) {
    playersTotal += bal;
    if (nation) { const x = nat(nation); x.players = r2(x.players + bal); x.members++; }
    if (town && townWealth[town]) townWealth[town][1] = r2(townWealth[town][1] + bal);
  }
  const townsTotal = towns.reduce((s, t) => s + t[2], 0), nationsTotal = nations.reduce((s, n) => s + n[1], 0);
  const all = r2(playersTotal + townsTotal + nationsTotal);
  for (const x of N.values()) x.wealth = r2(x.bank + x.towns + x.players);

  // the property market
  const listings = (qs?.quarters || []).filter(q => q.sale && q.price > 0).map(q => ({ ...q, ppb:q.vol ? q.price / q.vol : null }));
  const ppbAll = listings.map(q => q.ppb).filter(v => v != null), idx = median(ppbAll);
  const byNat = new Map();
  for (const q of listings) if (q.nation && q.ppb != null) byNat.set(q.nation, [...(byNat.get(q.nation) || []), q.ppb]);
  for (const q of listings) {
    const local = byNat.get(q.nation), ref = local && local.length >= 4 ? median(local) : idx;
    q.ratio = q.ppb != null && ref ? q.ppb / ref : null;
    q.prev = qs.prev?.[q.id] ?? null;
  }
  const fresh = qs?.prev ? listings.filter(q => q.prev == null) : [], cuts = listings.filter(q => q.prev != null && q.price < q.prev);
  const steals = listings.filter(q => q.ratio != null && q.ratio <= 0.5 && (q.vol || 0) >= 8).sort((a, b) => a.ratio - b.ratio);
  const townsForSale = towns.filter(t => t[3] > 0).map(t => ({ n:t[0], nation:t[1], price:r2(t[3]), bank:r2(t[2]), res:t[6] || 0, x:t[4], z:t[5] }))
    .sort((a, b) => b.bank / b.price - a.bank / a.price);

  // series, thinned with age like the intelligence archive
  state.series.global.push([at, all, r2(playersTotal), r2(townsTotal), r2(nationsTotal), listings.length, idx == null ? null : r2(idx)]);
  state.series.global = compact(state.series.global, at);
  for (const x of N.values()) { const s = state.series.nations[x.n] || []; s.push([at, x.wealth, x.bank, x.towns, x.players]); state.series.nations[x.n] = compact(s, at); }
  for (const k of Object.keys(state.series.nations)) if (!N.has(k) && state.series.nations[k].at(-1)[0] < at - 30 * DAY) delete state.series.nations[k];
  const ago = (s, ms) => { const t = at - ms; let best = null; for (const p of s) if (p[0] <= t + 18e5) best = p; return best; };
  const nationRows = [...N.values()].map(x => {
    const s = state.series.nations[x.n] || [], d1 = ago(s, DAY), d7 = ago(s, 7 * DAY);
    return { ...x, d24:d1 ? r2(x.wealth - d1[1]) : null, d7:d7 ? r2(x.wealth - d7[1]) : null, pct24:d1 && d1[1] ? (x.wealth - d1[1]) / d1[1] : null };
  }).sort((a, b) => b.wealth - a.wealth);

  // players: richest, and who gained or lost most since the last snapshot and over a day
  const moved = (from) => from ? Object.entries(snap).map(([n, v]) => from[n] ? { n, d:r2(v[0] - from[n][0]), bal:v[0], town:v[1], nation:v[2] } : null).filter(x => x && x.d) : [];
  const mv3 = moved(prevSnap), mv24 = moved(p24);
  const top = (a, f, k) => [...a].sort(f).slice(0, k);
  // towns: banks over the last day, and how long the falling ones can last
  const t24 = state.townHourly.find(s => s.at >= at - 25 * 36e5);
  const townMoves = t24 ? towns.map(t => { const o = t24.b[t[0]]; return o ? { n:t[0], nation:t[1], bal:r2(t[2]), d:r2(t[2] - o[0]) } : null; }).filter(x => x && x.d) : [];
  const hours = t24 ? Math.max(1, (at - t24.at) / 36e5) : 24;
  const watch = townMoves.filter(t => t.d < 0 && t.bal > 0).map(t => ({ ...t, burn:r2(-t.d * 24 / hours), runway:t.bal / (-t.d * 24 / hours) })).filter(t => t.runway < 7 && t.burn >= 5).sort((a, b) => a.runway - b.runway);

  // flows between nations over the week
  const corr = new Map();
  for (const f of state.flows) if (f.a.nation && f.b.nation && f.a.nation !== f.b.nation) { const k = f.a.nation + "→" + f.b.nation, e = corr.get(k) || { from:f.a.nation, to:f.b.nation, amt:0, n:0 }; e.amt = r2(e.amt + f.amt); e.n++; corr.set(k, e); }

  const lite = q => ({ id:q.id, name:q.name, type:q.type, town:q.town, nation:q.nation, owner:q.owner, price:q.price, vol:q.vol, ppb:q.ppb == null ? null : r2(q.ppb), ratio:q.ratio == null ? null : Math.round(q.ratio * 100) / 100, prev:q.prev, x:q.x, z:q.z });
  save();
  return {
    at, deepAt:state.deepAt, deepErr:state.deepErr, coverage:{ players:Object.keys(snap).length, quarters:qs?.quarters.length || 0, listings:listings.length, towns:towns.length },
    totals:{ all, players:r2(playersTotal), towns:r2(townsTotal), nations:r2(nationsTotal) },
    series:{ global:state.series.global.filter(p => p[0] > at - 30 * DAY), nations:Object.fromEntries(nationRows.slice(0, 120).map(x => [x.n, (state.series.nations[x.n] || []).filter(p => p[0] > at - 30 * DAY).map(p => [p[0], p[1]])])) },
    nations:nationRows,
    townWealth,
    richest:top(Object.entries(snap).map(([n, v]) => ({ n, bal:v[0], town:v[1], nation:v[2] })), (a, b) => b.bal - a.bal, 50),
    movers:{ up3:top(mv3.filter(m => m.d > 0), (a, b) => b.d - a.d, 25), down3:top(mv3.filter(m => m.d < 0), (a, b) => a.d - b.d, 25),
      up24:top(mv24.filter(m => m.d > 0), (a, b) => b.d - a.d, 25), down24:top(mv24.filter(m => m.d < 0), (a, b) => a.d - b.d, 25) },
    townMovers:{ up:top(townMoves.filter(t => t.d > 0), (a, b) => b.d - a.d, 20), down:top(townMoves.filter(t => t.d < 0), (a, b) => a.d - b.d, 20) },
    watch:watch.slice(0, 40),
    flows:top(state.flows.filter(f => f.at > at - 2 * DAY), (a, b) => b.amt - a.amt, 300),
    corridors:top([...corr.values()], (a, b) => b.amt - a.amt, 40),
    property:{ idx:idx == null ? null : r2(idx), count:listings.length,
      byNation:[...byNat].map(([n, a]) => ({ n, count:a.length, median:r2(median(a)) })).sort((a, b) => b.count - a.count).slice(0, 60),
      steals:steals.slice(0, 60).map(lite), listings:top(listings, (a, b) => (a.ratio ?? 9) - (b.ratio ?? 9), 500).map(lite),
      cuts:top(cuts, (a, b) => (a.price / a.prev) - (b.price / b.prev), 40).map(lite), fresh:top(fresh, (a, b) => (a.ratio ?? 9) - (b.ratio ?? 9), 40).map(lite),
      townsForSale:townsForSale.slice(0, 80) },
  };
}
// keep every point for three days, one per six hours for a month, then one a day
function compact(pts, now) {
  const out = [], seen = new Set();
  for (let i = pts.length - 1; i >= 0; i--) {
    const age = now - pts[i][0], b = age < 3 * DAY ? "r" + i : age < 30 * DAY ? "h" + Math.floor(pts[i][0] / (6 * 36e5)) : "d" + Math.floor(pts[i][0] / DAY);
    if (seen.has(b)) continue; seen.add(b); out.push(pts[i]);
  }
  return out.reverse();
}

/* ---------- schedule: the deep scan runs between the hourly scans, never during one ---------- */
let busy = () => false, after = async () => {}, running = false, last = null;
function start(opts) {
  busy = opts.busy || busy; after = opts.after || after;
  if (process.env.FINANCE_DEEP === "off") return; // tests: banks only, no player or property scans
  setInterval(tick, 60e3).unref?.();
  setTimeout(tick, 90e3);
}
async function tick() {
  if (running || busy()) return;
  const now = Date.now(), min = new Date(now).getUTCMinutes();
  const due = !state.deepAt || now - state.deepAt >= DEEP_EVERY;
  // after the first, deep scans start between twenty and fifty minutes past the hour, clear of the hourly scan
  if (!due || (state.deepAt && (min < 20 || min > 50)) || !state.townHourly.length) return;
  running = true;
  try { last = await deepScan(); console.log(`finance: ${last.players} players and ${last.quarters} quarters read in ${last.seconds}s`); await after(); }
  catch (e) { state.deepErr = String(e.message || e).slice(0, 300); save(); console.warn("finance: deep scan failed:", state.deepErr); }
  finally { running = false; }
}
const status = () => ({ deepAt:state.deepAt, deepErr:state.deepErr, running, snapshots:state.snaps.length, last });

module.exports = { start, hourly, deepScan, status, inferFlows, _state:state };
