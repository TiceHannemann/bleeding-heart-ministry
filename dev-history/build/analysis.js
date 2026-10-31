/* ---------- Analysis: trends, forecasts and anticipated moves ----------
   Reads the archive. Trends compare now with 24 hours, 7 days and 30 days ago, plus a
   least-squares slope over the last week. Anticipated courses of action are scored 0-1 from those
   trends, recent events, forecasts and alliance structure, then expressed in standard estimative
   language. Confidence reflects how much history the archive holds for that nation. */
const DAY = 864e5;
const seriesOf = name => ARCHIVE.series.get(name) || [];
function valAt(pts, idx, t) { let v = null; for (const p of pts) { if (p[0] <= t) { if (p[idx] != null) v = p[idx]; } else break; } return v; }
function trend(name, key) {
  const pts = seriesOf(name), idx = PT[key]; if (!pts.length) return null;
  const last = pts[pts.length - 1], now = last[0], cur = last[idx];
  const d = span => { const v = valAt(pts, idx, now - span); return v == null || cur == null ? null : cur - v; };
  const w = pts.filter(p => p[0] >= now - 7 * DAY && p[idx] != null);
  let slope = null;
  if (w.length >= 3 && w[w.length - 1][0] - w[0][0] > 6 * 36e5) {
    const mx = w.reduce((s, p) => s + p[0], 0) / w.length, my = w.reduce((s, p) => s + p[idx], 0) / w.length;
    let sxy = 0, sxx = 0; for (const p of w) { sxy += (p[0] - mx) * (p[idx] - my); sxx += (p[0] - mx) ** 2; }
    slope = sxx ? sxy / sxx * DAY : 0;
  }
  return { cur, d24:d(DAY), d7:d(7 * DAY), d30:d(30 * DAY), slope, n:pts.length, span:now - pts[0][0], first:pts[0][0] };
}
const anyDelta = t => t ? (t.d7 ?? t.d24 ?? (t.n > 1 ? 0 : null)) : null;
function dataConfidence(name) {
  const pts = seriesOf(name), span = pts.length ? pts[pts.length - 1][0] - pts[0][0] : 0;
  return span >= 7 * DAY && pts.length >= 20 ? "high" : span >= DAY && pts.length >= 4 ? "moderate" : "low";
}
const ESTIMATIVE = [[.95, "almost certain"], [.8, "highly likely"], [.55, "likely"], [.45, "roughly even chance"], [.2, "unlikely"], [.05, "highly unlikely"], [0, "remote"]];
const estimate = s => ESTIMATIVE.find(([t]) => s >= t)[1];
const clamp01 = v => Math.max(0, Math.min(1, v));
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const bearingName = (dx, dz) => COMPASS[Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360) / 45) % 8];
const centroid = ts => { const p = ts.filter(t => t.c && !t.ruined); return p.length ? { x:p.reduce((s, t) => s + t.c.x, 0) / p.length, z:p.reduce((s, t) => s + t.c.z, 0) / p.length } : null; };
const eventsFor = (name, days) => ARCHIVE.events.filter(e => e.at >= Date.now() - days * DAY && (e.ns || []).includes(name));
function fmtDay(ts) { return new Date(ts).toLocaleDateString(undefined, { day:"numeric", month:"short" }); }
function eventText(e, about) {
  const t = e.town, o = e.ns?.find(x => x !== about);
  return ({
    town_new:`${t} founded${e.ns?.[0] ? ` in ${e.ns[0]}` : ""}`, town_gone:`${t} deleted`, town_ruin:`${t} fell to ruin`,
    town_switch:e.to === about ? `${t} joined from ${e.from}` : `${t} left for ${e.to}`, town_join:`${t} joined`, town_leave:`${t} left the nation`,
    land:`${t} ${e.d > 0 ? "claimed" : "lost"} ${Math.abs(e.d)} chunks`, mayor_change:`${t}: mayor ${e.from} replaced by ${e.to}`,
    nation_new:`${e.ns[0]} founded`, nation_gone:`${e.ns[0]} dissolved`,
    ally_add:about === e.ns[0] ? `allied with ${e.who}` : `${e.ns[0]} allied with ${about === e.who ? "this nation" : e.who}`,
    ally_drop:about === e.ns[0] ? `ended alliance with ${e.who}` : `${e.ns[0]} ended its alliance with ${about === e.who ? "this nation" : e.who}`,
    enemy_add:about === e.ns[0] ? `declared ${e.who} an enemy` : `${e.ns[0]} declared ${about === e.who ? "this nation" : e.who} an enemy`,
    enemy_drop:about === e.ns[0] ? `removed ${e.who} as an enemy` : `${e.ns[0]} removed ${about === e.who ? "this nation" : e.who} as an enemy`,
    leader_change:`leadership passed from ${e.from} to ${e.to}`, capital_change:`capital moved from ${e.from} to ${e.to}`,
  })[e.type] || e.type;
}
// towns of this nation that will ruin within N days if nobody logs in (and aren't protected)
function ruinsWithin(n, days) {
  return n.towns.filter(t => { if (t.ruined || isProtected(t)) return false; const e = etaOf(t); return e != null && e < days * DAY; }).sort((a, b) => etaOf(a) - etaOf(b));
}
// expansion: where the nation's new towns appeared (vs a week ago), else drift of its centre
function expansionOf(n) {
  const f = ARCHIVE.frame7, now = centroid(n.towns);
  if (!now) return null;
  let dx = 0, dz = 0, basis = "";
  if (f) {
    const was = Object.entries(f.t).filter(([, v]) => v.na === n.name).map(([k]) => k);
    const fresh = n.towns.filter(t => t.c && !t.ruined && !was.includes(t.name));
    if (fresh.length && was.length) { const c = centroid(fresh); dx = c.x - now.x; dz = c.z - now.z; basis = `${townsN(fresh.length)} gained`; }
  }
  if (!basis) { const tx = trend(n.name, "cx"), tz = trend(n.name, "cz"); if (tx?.d7 != null && Math.hypot(tx.d7, tz.d7) > 150) { dx = tx.d7; dz = tz.d7; basis = "drift of its centre"; } }
  if (!basis) return null;
  const dir = bearingName(dx, dz), ang = Math.atan2(dx, -dz);
  // the nearest other nation lying in that direction
  let toward = null, best = Infinity;
  for (const m of nations) { if (m === n) continue; const c = centroid(m.towns); if (!c) continue;
    const a = Math.atan2(c.x - now.x, -(c.z - now.z)), diff = Math.abs(((a - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI), d = Math.hypot(c.x - now.x, c.z - now.z);
    if (diff < Math.PI / 4.5 && d < best) { best = d; toward = m; } }
  return { dir, toward, basis };
}
// how threatening each nation is to a given nation (the "perspective")
function threatsTo(p) {
  const map = assessAll(p.name);
  return nations.filter(n => n !== p).map(n => { const a = map.get(n.name); const tA = anyDelta(trend(n.name, "a30"));
    return { n, a, tA, threat:Math.round(a.hostility * (0.5 + a.strength / 200) * (a.contact ? 1.2 : 1)) }; })
    .filter(x => x.a.hostility > 0 || x.a.stance === "hostile").sort((a, b) => b.threat - a.threat);
}
// scored courses of action for a nation, relative to a perspective nation
function anticipate(n, p) {
  const a = assess(n, p?.name), tA = trend(n.name, "a30"), tC = trend(n.name, "chunks"), tT = trend(n.name, "towns"), tR = trend(n.name, "res"), tG = trend(n.name, "gold"), tD = trend(n.name, "dHQ");
  const rel = (d, base) => d == null || !base ? 0 : d / base;
  const gA = rel(anyDelta(tA), n.active30), gC = rel(anyDelta(tC), n.chunks), gR = rel(anyDelta(tR), n.residents), gG = rel(anyDelta(tG), goldOf(n));
  const ruin7 = ruinsWithin(n, 7), exp = expansionOf(n), ev14 = eventsFor(n.name, 14), conf = dataConfidence(n.name);
  const newEnemies = ev14.filter(e => e.type === "enemy_add" && e.ns[0] === n.name), churn = ev14.filter(e => /ally_|enemy_/.test(e.type) && e.ns[0] === n.name).length;
  const leaderLeft = n.kingLast != null ? days() - (Date.now() - n.kingLast) / DAY : null;
  const out = [];
  const add = (key, s, text, o = {}) => out.push({ key, s:clamp01(s), likelihood:estimate(clamp01(s)), conf:o.conf || conf, text, danger:o.danger || 0 });
  if (gC > 0.005 || exp) add("expand", 0.35 + gC * 5 + (tT && anyDelta(tT) > 0 ? 0.12 : 0) + (exp ? 0.12 : 0) - Math.max(0, -gA) * 0.8,
    `${n.name} will continue to expand its territory${exp ? ` to the ${exp.dir}${exp.toward ? `, toward ${exp.toward.name}` : ""}` : ""}.`, { danger:exp?.toward === p ? 0.6 : 0.15 });
  if (ruin7.length || gA < -0.05 || gC < -0.02) add("contract", 0.25 + ruin7.length / Math.max(4, n.towns.length) * 3 + Math.max(0, -gA) * 2.5 + Math.max(0, -gC) * 3,
    `${n.name} will lose towns or land over the next 7 days${ruin7.length ? `; ${townsN(ruin7.length)} ${ruin7.length === 1 ? "is" : "are"} forecast to ruin` : ""}.`);
  if (leaderLeft != null && leaderLeft < 14) add("succession", leaderLeft <= 0 ? 0.9 : leaderLeft < 3 ? 0.75 : 0.5,
    leaderLeft <= 0 ? `Leadership of ${n.name} will change hands at the next purge; ${n.king} is past the inactivity limit.` : `Leadership of ${n.name} will change within ${Math.ceil(leaderLeft)} days unless ${n.king} returns.`, { conf:"high" });
  // realignment: nations sharing enemies, or allied with its allies, that it isn't yet aligned with
  const cands = nations.filter(m => m !== n && !n.allies.includes(m.name) && !n.enemies.includes(m.name)).map(m => ({ m, k:m.enemies.filter(x => n.enemies.includes(x)).length + m.allies.filter(x => n.allies.includes(x)).length }))
    .filter(x => x.k >= 2).sort((x, y) => y.k - x.k);
  if (cands.length) add("realign", 0.25 + cands[0].k * 0.08 + Math.min(0.2, churn * 0.07), `${n.name} will seek closer ties with ${cands[0].m.name} (${cands[0].k} shared allies or enemies).`, { danger:cands[0].m === p ? 0 : 0.1 });
  const surge = gA > 0.12 && gG > 0.05;
  if (newEnemies.length || surge) {
    const target = newEnemies.length ? newEnemies[newEnemies.length - 1].who : (p && a.stance === "hostile" ? p.name : n.enemies[0]);
    add("hostile", 0.3 + newEnemies.length * 0.15 + (surge ? 0.2 : 0), `${n.name} is preparing hostile action${target ? ` against ${target}` : ""}${surge ? ": active membership and treasury are both rising sharply" : ""}.`, { danger:target === p?.name ? 0.9 : 0.3 });
  }
  if (gR > 0.08) add("recruit", 0.45 + gR * 2, `${n.name} is running a recruitment drive (residents ${anyDelta(tR) > 0 ? "+" : ""}${anyDelta(tR)} in the period).`);
  if (p && p !== n && p === findNation($("myNation").value) && tD?.slope != null && tD.slope < -25 && a.hostility >= 25) add("encroach", 0.4 + Math.min(0.4, -tD.slope / 300), `${n.name} is closing on ${p.name}'s territory (about ${Math.round(-tD.slope)} blocks a day).`, { danger:0.8 });
  const top = Math.max(0, ...out.map(x => x.s));
  add("status", 0.9 - top * 0.8, `${n.name} will hold its current posture with no major change.`);
  out.sort((x, y) => y.s - x.s);
  const dangerous = out.filter(x => x.danger >= 0.5).sort((x, y) => y.danger * y.s - x.danger * x.s)[0] || null;
  return { coas:out, likely:out[0], dangerous, ruin7, exp, leaderLeft, conf, tA, tC, tT, tR, tG, tD, gA, gC, gR, newEnemies };
}
