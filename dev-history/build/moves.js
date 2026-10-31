/* ---------- Movement Watch ----------
   The live map publishes where every visible player is standing. Polled every few seconds, each
   position is matched to the claimed chunk under it, so the Ministry sees who walks into whose land.
   - A visit opens when a player stands in a town that isn't theirs and isn't in their nation, and
     closes when they leave it or drop off the map.
   - Each visit records how long they stayed, how much of it they spent along the border or at the
     town spawn, whether they arrived by teleport, how much they wandered, and who they are.
   - The "scout" model scores every visit for reconnaissance. Labelling a visit trains it.
   - The "probe7" Forecast Lab model turns a day of visits between two nations into a forecast of a
     hostile move within 7 days; the event log checks it and it learns from the result.
   Players can be hidden from the live map, so absence is not evidence. Collection runs while the page is open. */
const MOVES = { on:false, every:15, src:"", timer:null, lastOk:0, err:"", polls:0, online:0, players:new Map(), visits:[], idx:null, idxFor:null, people:new Map(), alerted:new Map(), hours:new Set(), loaded:false, filter:"all" };
const MOVE_SPEED_TP = 60; // blocks per second; anything faster between two samples was a teleport (warp, /t spawn, /n spawn)
const PASSING = "Passing through", RECON = "Reconnaissance";
const movesSrc = () => MOVES.src || `${TILES.base.replace(/\/+$/, "")}/tiles/players.json`;
try { const s = JSON.parse(localStorage.getItem("bh_moves") || "{}"); Object.assign(MOVES, { on:!!s.on, every:s.every || 15, src:s.src || "" }); } catch {}
const saveMoveCfg = () => { try { localStorage.setItem("bh_moves", JSON.stringify({ on:MOVES.on, every:MOVES.every, src:MOVES.src })); } catch {} };

// claimed chunk -> town, and player -> their town; rebuilt whenever a new scan replaces the towns
function moveIndex() {
  if (MOVES.idxFor === towns) return MOVES.idx;
  const idx = new Map(), people = new Map();
  for (const t of towns) {
    let cl = t.claims?.length ? t.claims : null;
    if (!cl && t.c) { // no claim list from the API: a square of the town's size around its centre
      const s = Math.max(1, Math.round(Math.sqrt(t.blocks || 1))), x0 = Math.floor(t.c.x / 16) - (s >> 1), z0 = Math.floor(t.c.z / 16) - (s >> 1);
      cl = []; for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) cl.push([x0 + i, z0 + j]);
    }
    for (const c of cl || []) if (Array.isArray(c)) idx.set(c[0] + "," + c[1], t);
    for (const p of t.people || []) people.set(p, t);
  }
  Object.assign(MOVES, { idx, people, idxFor:towns });
  return idx;
}
// a claim is on the border when one of its four neighbours belongs to someone else
const onBorder = (x, z, t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => MOVES.idx.get((x + a) + "," + (z + b)) !== t);
// how two nations stand: 1 enemies, 0.5 on opposite sides, 0 unconnected, -0.5 allies
const relScore = (a, b) => !a || !b || a === b ? 0 : a.enemies.includes(b.name) || b.enemies.includes(a.name) ? 1 : a.allies.includes(b.name) || b.allies.includes(a.name) ? -0.5
  : a.allies.some(x => b.enemies.includes(x)) || b.allies.some(x => a.enemies.includes(x)) ? 0.5 : 0;
const homeNation = () => findNation($("myNation").value);
const isOurLand = nationName => { const h = homeNation(); return !!h && !!nationName && (nationName === h.name || h.allies.includes(nationName)); };
const stanceOf = nationName => { if (!nationName) return "neutral"; const a = assessAll().get(nationName); return a?.stance || "neutral"; };

async function pollMoves() {
  clearTimeout(MOVES.timer); MOVES.timer = null;
  if (!MOVES.on) return;
  if (!towns.length) MOVES.err = "Run a scan first: positions are matched against town claims.";
  else try {
    const src = movesSrc(), r = await fetch(src + (src.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache:"no-store" });
    if (!r.ok) throw new Error(`the feed answered ${r.status}`);
    ingestMoves(await r.json(), Date.now());
    MOVES.err = ""; MOVES.lastOk = Date.now(); MOVES.polls++;
  } catch (e) {
    MOVES.err = e instanceof TypeError ? "Your browser won't let this page read the live map feed directly. Start the relay below, then press Use relay." : `Couldn't read the feed (${e.message}).`;
  }
  if (MOVES.on) MOVES.timer = setTimeout(pollMoves, MOVES.every * 1000);
  if (tab === "moves") renderMoves();
}
function ingestMoves(j, now) {
  const idx = moveIndex(), list = (Array.isArray(j) ? j : j?.players) || [], seen = new Set();
  MOVES.online = list.length;
  const hour = Math.floor(now / 36e5); if (!MOVES.hours.has(hour)) { MOVES.hours.add(hour); saveMoveHours(); }
  for (const p of list) {
    if (!p?.name || p.x == null || p.z == null || (p.world && !/overworld|^world$/i.test(p.world) && p.world !== TILES.world)) continue;
    const x = +p.x, z = +p.z, cx = Math.floor(x / 16), cz = Math.floor(z / 16), t = idx.get(cx + "," + cz) || null;
    seen.add(p.name);
    let s = MOVES.players.get(p.name);
    if (!s) { s = { name:p.name, x, z, at:now, trail:[], visit:null }; MOVES.players.set(p.name, s); }
    const step = Math.hypot(x - s.x, z - s.z), dt = Math.max(1, (now - s.at) / 1000), tp = s.trail.length > 0 && step / dt > MOVE_SPEED_TP;
    const home = MOVES.people.get(p.name) || null;
    const foreign = t && t !== home && !(home?.nation && home.nation === t.nation);
    if (s.visit && s.visit.town !== t?.name) closeVisit(s);
    if (foreign) {
      if (!s.visit) s.visit = { player:p.name, pt:home?.name || null, pn:home?.nation || null, town:t.name, nation:t.nation || null, ruined:!!t.ruined,
        start:now, end:now, n:0, edge:0, spawn:0, dist:0, chunks:new Set(), warp:tp || !s.trail.length && false, x0:x, z0:z, x1:x, z1:z, path:[] };
      const v = s.visit;
      if (v.n && !tp) v.dist += step;
      v.end = now; v.n++; v.x1 = x; v.z1 = z; v.chunks.add(cx + "," + cz);
      if (onBorder(cx, cz, t)) v.edge++;
      if (t.spawn && Math.hypot(x - t.spawn.x, z - t.spawn.z) < 24) v.spawn++;
      const last = v.path[v.path.length - 1]; if (!last || Math.hypot(x - last[1], z - last[2]) > 24) { v.path.push([now, Math.round(x), Math.round(z)]); if (v.path.length > 60) v.path.splice(1, 1); }
      if (v.n === 1) moveAlert(v);
    }
    s.trail.push([now, x, z]); while (s.trail.length > 40 || (s.trail.length && now - s.trail[0][0] > 10 * 6e4)) s.trail.shift();
    Object.assign(s, { x, z, at:now, town:t?.name || null, host:t?.nation || null, pn:home?.nation || null, foreign:!!foreign });
  }
  // dropped off the map (logged out or hidden): close the visit after two missed polls; forget them after 15 minutes
  for (const [name, s] of MOVES.players) if (!seen.has(name) && now - s.at > Math.max(40e3, MOVES.every * 2500)) {
    if (s.visit) closeVisit(s);
    if (now - s.at > 15 * 6e4) MOVES.players.delete(name);
  }
}

// ---- visits ----
function visitFeatures(v) {
  const host = findNation(v.nation), vis = findNation(v.pn), n = Math.max(1, v.n), week = v.start - 7 * DAY;
  const disp = Math.hypot(v.x1 - v.x0, v.z1 - v.z0);
  const repeat = MOVES.visits.filter(o => o.player === v.player && o.nation && o.nation === v.nation && o.at > week).length;
  const sameDay = new Set([v.town, ...MOVES.visits.filter(o => o.player === v.player && o.nation && o.nation === v.nation && o.at > v.start - DAY).map(o => o.town)]).size;
  return [1, cl(Math.log1p(v.dwell / 6e4) / 3, 0, 1.5), v.edge / n, v.spawn / n, v.warp ? 1 : 0, v.n > 2 ? cl(v.dist / Math.max(32, disp) / 5, 0, 1) : 0,
    Math.max(0, relScore(vis, host)), vis && host && vis.enemies.includes(host.name) ? 1 : 0, cl(Math.log1p(repeat) / 2, 0, 1.5), cl(Math.log1p(sameDay - 1) / 1.5, 0, 1.5), isOurLand(v.nation) ? 1 : 0];
}
function purposeOf(v, p) {
  if (v.ruined) return "Looting";
  if (v.n <= 2 && v.dwell < 75e3 && !v.spawn) return PASSING;
  if (p >= 0.55) return RECON;
  if (v.spawn / Math.max(1, v.n) >= 0.35 || v.warp) return "Trade or visit";
  return "Visit";
}
function closeVisit(s) {
  const v = s.visit; s.visit = null; if (!v) return;
  v.dwell = v.end - v.start + MOVES.every * 1000; // each sample stands for one polling interval
  const x = visitFeatures(v), p = mlPredict("scout", x);
  const rec = { at:v.start, end:v.end, dwell:v.dwell, player:v.player, pt:v.pt, pn:v.pn, town:v.town, nation:v.nation, ruined:v.ruined, n:v.n,
    edge:v.edge / Math.max(1, v.n), spawn:v.spawn / Math.max(1, v.n), warp:!!v.warp, chunks:v.chunks.size, dist:Math.round(v.dist), path:v.path, x, p, p0:mlPrior("scout", x) };
  rec.purpose = purposeOf({ ...v, spawn:v.spawn }, p);
  MOVES.visits.push(rec);
  // single glimpses of someone crossing a town aren't worth keeping, unless the land is ours
  if (rec.purpose !== PASSING || isOurLand(rec.nation)) idbDo(["visits"], "readwrite", tx => { const r = tx.objectStore("visits").add(rec); r.onsuccess = () => { rec.id = r.result; }; }).catch(() => {});
}
// a hostile or wary nation's member just walked into our land, or an ally's
function moveAlert(v) {
  if (!isOurLand(v.nation)) return;
  const st = stanceOf(v.pn); if (st !== "hostile" && st !== "wary") return;
  const k = v.player + "|" + v.town; if (Date.now() - (MOVES.alerted.get(k) || 0) < 36e5) return;
  MOVES.alerted.set(k, Date.now());
  const msg = `${v.player} of ${v.pn} (${st}) has entered ${v.town}, ${v.nation === homeNation()?.name ? "a Kingdom town" : `a town of our ally ${v.nation}`}.`;
  showToast(msg);
  try { if (Notification?.permission === "granted") new Notification("Movement Watch", { body:msg }); } catch {}
}
// labelling a visit teaches the reconnaissance model (scored on what it said before being told)
async function labelVisit(rec, label) {
  if (rec.label) { rec.label = label; } else {
    rec.label = label;
    learn({ model:"scout", subject:rec.player, x:rec.x, p:rec.p, p0:rec.p0 }, label === RECON ? 1 : 0);
  }
  try { await idbDo(["visits", "meta"], "readwrite", tx => { if (rec.id != null) tx.objectStore("visits").put(rec); tx.objectStore("meta").put(mlState(), "ml"); }); } catch {}
}
const scoutNow = rec => mlPredict("scout", rec.x);

async function loadMoves() {
  try {
    const since = Date.now() - 30 * DAY;
    await idbDo(["visits", "meta"], "readwrite", async tx => {
      const st = tx.objectStore("visits");
      MOVES.visits = (await reqP(st.index("at").getAll(IDBKeyRange.lowerBound(since)))).sort((a, b) => a.at - b.at);
      st.index("at").openCursor(IDBKeyRange.upperBound(since)).onsuccess = e => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
      const h = await reqP(tx.objectStore("meta").get("moveHours"));
      MOVES.hours = new Set((h || []).filter(x => x > Date.now() / 36e5 - 30 * 24));
    });
    MOVES.loaded = true;
  } catch (e) { console.warn("Movement archive unavailable:", e); }
}
function saveMoveHours() { idbDo(["meta"], "readwrite", tx => tx.objectStore("meta").put([...MOVES.hours], "moveHours")).catch(() => {}); }
// hours of collection in the last N days
const moveHoursIn = days => [...MOVES.hours].filter(h => h >= Date.now() / 36e5 - days * 24).length;

// ---- nation-to-nation picture ----
const visitsBetween = (A, B, since) => MOVES.visits.filter(v => v.at >= since && v.purpose !== PASSING && (!A || v.pn === A) && (!B || v.nation === B));
function movePairs(since) {
  const m = new Map();
  for (const v of MOVES.visits) {
    if (v.at < since || v.purpose === PASSING || !v.pn || !v.nation || v.pn === v.nation) continue;
    const k = v.pn + " → " + v.nation, e = m.get(k) || { A:v.pn, B:v.nation, key:k, visits:0, recon:0, people:new Set(), towns:new Set(), last:0 };
    e.visits++; if (v.purpose === RECON) e.recon++; e.people.add(v.player); e.towns.add(v.town); e.last = Math.max(e.last, v.end);
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.recon - a.recon || b.visits - a.visits);
}
function pairFeatures(pr) {
  const vis = findNation(pr.A), host = findNation(pr.B), now = Date.now();
  const d1 = visitsBetween(pr.A, pr.B, now - DAY), d7 = visitsBetween(pr.A, pr.B, now - 7 * DAY), ps = d1.map(scoutNow);
  const cA = vis ? centroid(vis.towns) : null, cB = host ? centroid(host.towns) : null;
  return [1, cl(Math.log1p(d1.length) / 2, 0, 2), cl(Math.log1p(new Set(d1.map(v => v.player)).size) / 2, 0, 2), ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0,
    d1.length ? d1.filter(v => v.purpose === RECON).length / d1.length : 0, Math.max(0, relScore(vis, host)), vis?.enemies.includes(pr.B) ? 1 : 0, vis?.allies.includes(pr.B) ? 1 : 0,
    cA && cB && Math.hypot(cA.x - cB.x, cA.z - cB.z) < CONTACT_RANGE * 2 ? 1 : 0, vis ? assess(vis).strength / 100 : 0, host ? assess(host).risk / 100 : 0,
    new Set(d7.map(v => new Date(v.at).toDateString())).size / 7];
}
// pairs worth a forecast at this scan: at least two real visits in the last day
const pairCandidates = () => movePairs(Date.now() - DAY).filter(e => e.visits >= 2).slice(0, 60);
const pairForecast = (A, B) => ML.open.find(p => p.model === "probe7" && p.subject === A + " → " + B && p.due > Date.now());

// ---- the relay, for browsers that won't read the map feed directly ----
const RELAY_PY = `# Bleeding Heart movement relay
# Lets the Ministry site read the EarthMC live map's player feed from your own computer.
# Run:  python relay.py   (Python 3, nothing to install), then press "Use relay" on Movement Watch.
import http.server, urllib.request
SRC = "https://map.earthmc.net/tiles/players.json"
class Relay(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            req = urllib.request.Request(SRC, headers={"User-Agent": "BleedingHeart-MovementRelay"})
            data, code = urllib.request.urlopen(req, timeout=10).read(), 200
        except Exception as e:
            data, code = str(e).encode(), 502
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *args):
        pass
print("Relay running. Feed source: http://localhost:8787/players.json  (Ctrl+C to stop)")
http.server.ThreadingHTTPServer(("127.0.0.1", 8787), Relay).serve_forever()
`;

// ---- page ----
const STANCE_COL = { home:"var(--hq)", ally:"var(--blue)", friendly:"var(--green)", neutral:"var(--mut)", wary:"var(--orange)", hostile:"var(--red)" };
const natChip = name => name ? `<span class="mv-nat" style="--c:${STANCE_COL[stanceOf(name)]}">${esc(name)}</span>` : `<span class="mv-nat" style="--c:var(--dim)">No nation</span>`;
const durShort = ms => ms < 6e4 ? Math.round(ms / 1000) + "s" : ms < 36e5 ? Math.round(ms / 6e4) + "m" : (ms / 36e5).toFixed(1) + "h";
const timeShort = t => new Date(t).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) + (Date.now() - t > DAY ? " " + fmtDay(t) : "");
function renderMoves() {
  if (!$("mvStats")) return;
  const now = Date.now(), day = now - DAY, week = now - 7 * DAY;
  $("mvOn").checked = MOVES.on; $("mvEvery").value = String(MOVES.every); $("mvSrc").value = MOVES.src;
  const live = [...MOVES.players.values()].filter(s => now - s.at < Math.max(40e3, MOVES.every * 2500));
  const intruders = live.filter(s => s.visit && isOurLand(s.visit.nation));
  const today = MOVES.visits.filter(v => v.at >= day && v.purpose !== PASSING);
  const hostileIn = intruders.filter(s => ["hostile", "wary"].includes(stanceOf(s.visit.pn)));
  $("mvState").innerHTML = !MOVES.on ? `Off. Switch on to start reading live positions${MOVES.visits.length ? ` · ${MOVES.visits.length.toLocaleString()} visits on record` : ""}.`
    : MOVES.err ? `<span style="color:var(--orange)">${esc(MOVES.err)}</span>`
    : MOVES.lastOk ? `Live · ${MOVES.online} players on the map · updated ${Math.round((now - MOVES.lastOk) / 1000)}s ago · ${moveHoursIn(7)} hours collected this week` : "Connecting…";
  $("mvRelay").hidden = !(MOVES.err && /relay/i.test(MOVES.err)) && !MOVES.src;
  const stat = (n, l, c) => `<div class="stat" style="--c:${c || "var(--intel)"}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  $("mvStats").innerHTML = stat(MOVES.on && MOVES.lastOk ? live.length : "—", "Players visible now") + stat(live.filter(s => s.foreign).length || (MOVES.lastOk ? 0 : "—"), "In foreign land now")
    + stat(intruders.length, "Inside our or allied land", "var(--hq)") + stat(today.length, "Visits in the last 24 hours") + stat(today.filter(v => v.purpose === RECON).length, "Judged reconnaissance", "var(--orange)")
    + stat(hostileIn.length, "Hostile visitors inside now", "var(--red)");
  // who is inside our borders right now
  $("mvLive").innerHTML = intruders.length ? `<table class="nt"><tr><th>Player</th><th>From</th><th>Where</th><th class="num">Inside</th><th>Looks like</th></tr>${intruders.sort((a, b) => relScore(findNation(b.visit.pn), homeNation()) - relScore(findNation(a.visit.pn), homeNation())).map(s => {
      const v = s.visit, dw = now - v.start + MOVES.every * 1000, x = visitFeatures({ ...v, dwell:dw }), p = mlPredict("scout", x), pu = purposeOf({ ...v, dwell:dw }, p);
      return `<tr><td><button class="pl-name" data-player="${esc(s.name)}" data-town="${esc(v.pt || "")}">${esc(s.name)}</button></td><td>${natChip(v.pn)}</td><td>${esc(v.town)} <span class="lab-ev">${esc(v.nation || "")}</span></td><td class="num">${durShort(dw)}</td><td>${mvPurpose(pu, p)}</td></tr>`; }).join("")}</table>`
    : `<p class="br-empty">${MOVES.on && MOVES.lastOk ? "No foreign players are inside Kingdom or allied land right now." : "Switch on live tracking to see who is inside our borders."}</p>`;
  // nation to nation, last 7 days
  const pairs = movePairs(week).slice(0, 18);
  $("mvPairs").innerHTML = pairs.length ? `<table class="nt"><tr><th>Visitors</th><th>Into</th><th class="num">Visits</th><th class="num">People</th><th class="num">Recon</th><th class="num">Hostile move, 7 days</th></tr>${pairs.map(e => {
      const f = pairForecast(e.A, e.B), p = f ? f.p : mlPredict("probe7", pairFeatures(e));
      return `<tr><td>${natChip(e.A)}</td><td>${natChip(e.B)}</td><td class="num">${e.visits}</td><td class="num">${e.people.size}</td><td class="num">${e.recon || "—"}</td>
        <td class="num" title="${f ? "Open Forecast Lab forecast, checked against the event log" : "Current model estimate; a forecast is logged at the next scan"}"><span class="lab-bar"><i style="width:${Math.round(p * 100)}%"></i></span>${pct(p)}${f ? "" : " ~"}</td></tr>`; }).join("")}</table>`
    : `<p class="br-empty">Nation-to-nation traffic appears here once visits are recorded.</p>`;
  // recent visits, with labels that train the model
  const F = { all:v => v.purpose !== PASSING, ours:v => isOurLand(v.nation), recon:v => v.purpose === RECON, hostile:v => ["hostile", "wary"].includes(stanceOf(v.pn)), unlabelled:v => !v.label && v.purpose !== PASSING };
  const list = MOVES.visits.filter(F[MOVES.filter] || F.all).slice(-80).reverse();
  document.querySelectorAll("[data-mvf]").forEach(b => b.classList.toggle("on", b.dataset.mvf === MOVES.filter));
  $("mvVisits").innerHTML = list.length ? `<table class="nt mv-visits"><tr><th>When</th><th>Player</th><th>From</th><th>Into</th><th class="num">Stay</th><th class="num">Border</th><th class="num">Spawn</th><th>Looks like</th><th>Your call</th></tr>${list.map(v => {
      const i = MOVES.visits.indexOf(v), p = scoutNow(v);
      return `<tr><td class="lab-ev">${timeShort(v.at)}</td><td><button class="pl-name" data-player="${esc(v.player)}" data-town="${esc(v.pt || "")}">${esc(v.player)}</button></td><td>${natChip(v.pn)}</td>
        <td>${esc(v.town)} <span class="lab-ev">${esc(v.nation || "")}</span></td><td class="num">${durShort(v.dwell)}${v.warp ? ' <span class="lab-ev" title="Arrived by teleport">tp</span>' : ""}</td><td class="num">${pct(v.edge)}</td><td class="num">${pct(v.spawn)}</td>
        <td>${mvPurpose(v.purpose, p)}</td><td class="mv-label">${["Reconnaissance", "Trade", "Passing", "Friendly"].map(l => `<button data-mvl="${i}" data-l="${l === "Reconnaissance" ? RECON : l}" class="${v.label === (l === "Reconnaissance" ? RECON : l) ? "on" : ""}">${l === "Reconnaissance" ? "Recon" : l}</button>`).join("")}</td></tr>`; }).join("")}</table>`
    : `<p class="br-empty">${MOVES.visits.length ? "No visits match this filter." : "Visits appear here as players walk into towns that aren't theirs."}</p>`;
  // frequent travellers
  const ppl = new Map();
  for (const v of MOVES.visits) { if (v.at < week || v.purpose === PASSING) continue; const e = ppl.get(v.player) || { name:v.player, pn:v.pn, pt:v.pt, n:0, recon:0, nations:new Set(), ours:0 }; e.n++; if (v.purpose === RECON) e.recon++; if (v.nation) e.nations.add(v.nation); if (isOurLand(v.nation)) e.ours++; ppl.set(v.player, e); }
  const top = [...ppl.values()].sort((a, b) => b.recon - a.recon || b.ours - a.ours || b.n - a.n).slice(0, 14);
  $("mvPeople").innerHTML = top.length ? `<table class="nt"><tr><th>Player</th><th>Of</th><th class="num">Visits</th><th class="num">Nations</th><th class="num">In our land</th><th class="num">Recon</th></tr>${top.map(e => `<tr><td><button class="pl-name" data-player="${esc(e.name)}" data-town="${esc(e.pt || "")}">${esc(e.name)}</button></td><td>${natChip(e.pn)}</td><td class="num">${e.n}</td><td class="num">${e.nations.size}</td><td class="num">${e.ours || "—"}</td><td class="num">${e.recon || "—"}</td></tr>`).join("")}</table>`
    : `<p class="br-empty">The most travelled players of the week appear here.</p>`;
  const m = mlState().models.scout;
  $("mvModel").innerHTML = `Reconnaissance model: ${m.n ? `${m.n} visit${m.n === 1 ? "" : "s"} labelled, ${pct(m.hits / m.n)} of them called correctly before you labelled them` : "using its starting rules. Label visits to teach it what reconnaissance looks like on this server"}.`;
}
const mvPurpose = (pu, p) => `<span class="mv-pu" style="--c:${pu === RECON ? "var(--orange)" : pu === "Looting" ? "var(--red)" : pu === PASSING ? "var(--dim)" : "var(--mut)"}">${esc(pu)}</span>${pu !== PASSING && pu !== "Looting" ? ` <span class="lab-ev">${pct(p)}</span>` : ""}`;
document.addEventListener("click", e => {
  const l = e.target.closest("[data-mvl]");
  if (l) { const rec = MOVES.visits[+l.dataset.mvl]; if (rec) labelVisit(rec, l.dataset.l).then(renderMoves); return; }
  const f = e.target.closest("[data-mvf]"); if (f) { MOVES.filter = f.dataset.mvf; renderMoves(); return; }
  if (e.target.id === "mvRelayGet") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([RELAY_PY], { type:"text/x-python" })); a.download = "relay.py"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  if (e.target.id === "mvRelayUse") { MOVES.src = "http://localhost:8787/players.json"; saveMoveCfg(); MOVES.err = ""; pollMoves(); renderMoves(); }
  if (e.target.id === "mvNotify") { try { Notification.requestPermission().then(p => showToast(p === "granted" ? "Desktop alerts on for hostile visitors." : "Desktop alerts were not allowed.")); } catch {} }
});
document.addEventListener("change", e => {
  if (e.target.id === "mvOn") { MOVES.on = e.target.checked; saveMoveCfg(); if (MOVES.on) { MOVES.err = ""; pollMoves(); } else { clearTimeout(MOVES.timer); for (const s of MOVES.players.values()) if (s.visit) closeVisit(s); } renderMoves(); }
  if (e.target.id === "mvEvery") { MOVES.every = +e.target.value || 15; saveMoveCfg(); if (MOVES.on) pollMoves(); }
  if (e.target.id === "mvSrc") { MOVES.src = e.target.value.trim(); saveMoveCfg(); if (MOVES.on) pollMoves(); }
});
setInterval(() => { if (tab === "moves" && !document.hidden) renderMoves(); }, 5000);

// ---- map layer: live positions, trails, and who is inside our land ----
function drawMovesLayer(placed, zoomR, dot) {
  const map = assessAll(), now = Date.now(), dpr = M.dpr;
  const col = { home:COL.hq, ally:COL.blue, friendly:COL.green, neutral:"rgba(255,255,255,.55)", wary:COL.orange, hostile:COL.red };
  for (const t of placed) if (!t.ruined && t.nation && isOurLand(t.nation)) dot(t, 2 * zoomR, alpha(t.nation === homeNation()?.name ? COL.hq : COL.blue, .55));
  const labels = [];
  for (const s of MOVES.players.values()) {
    if (now - s.at > Math.max(40e3, MOVES.every * 2500)) continue;
    const c = s.pn ? col[map.get(s.pn)?.stance || "neutral"] : "rgba(255,255,255,.4)", inOurs = s.visit && isOurLand(s.visit.nation);
    if (s.trail.length > 1) {
      ctx.lineWidth = dpr; ctx.strokeStyle = alpha(c, inOurs ? .8 : .35); ctx.beginPath(); let started = false;
      for (let i = 0; i < s.trail.length; i++) {
        const [, x, z] = s.trail[i], [sx, sy, d] = townScreen({ c:{ x, z } }); if (d <= 0) { started = false; continue; }
        const prev = s.trail[i - 1], tp = prev && Math.hypot(x - prev[1], z - prev[2]) / Math.max(1, (s.trail[i][0] - prev[0]) / 1000) > MOVE_SPEED_TP;
        if (!started || tp) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    const [x, y, d] = townScreen({ c:{ x:s.x, z:s.z } }); if (d <= 0) continue;
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, (inOurs ? 3.2 : s.foreign ? 2.4 : 1.8) * dpr, 0, 7); ctx.fill();
    if (inOurs) { const ping = (now % 1400) / 1400; ctx.strokeStyle = alpha(c, 1 - ping); ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(x, y, (5 + ping * 14) * dpr, 0, 7); ctx.stroke(); labels.push([x, y, s.name, c]); }
  }
  ctx.font = `600 ${11 * dpr}px Inter Tight, sans-serif`;
  for (const [x, y, name, c] of labels.slice(0, 24)) { const w = ctx.measureText(name).width; ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(x + 8 * dpr, y - 8 * dpr, w + 8 * dpr, 16 * dpr); ctx.fillStyle = c; ctx.fillText(name, x + 12 * dpr, y + 4 * dpr); }
}
