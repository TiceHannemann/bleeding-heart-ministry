/* ---------- Forecast Lab: predictions that learn from their own track record ----------
   After every scan, five online logistic-regression models forecast specific events:
     ruin72   a town falls to ruin within 72 hours  (at-risk towns plus a random sample of the rest)
     loss7    a nation loses a town within 7 days   (ruined, deleted, defected or left)
     gain7    a nation gains land within 7 days     (new or joining towns, or 16+ chunks claimed)
     diplo7   a nation changes an alliance or enmity within 7 days
     leader7  a nation's leadership changes within 7 days
   Each forecast is stored with the features it saw. When the event happens, or its window closes,
   a later scan checks the event log and the model takes one learning step on the real outcome
   (AdaGrad with L2). Models start from hand-set weights that mirror the rule-based assessments and
   drift toward whatever the data shows. Every forecast also records what those starting rules alone
   would have said, so Brier scores show honestly whether the model is getting smarter. */
const ML_MODELS = {
  ruin72:{ label:"Town falls to ruin", horizon:3, unit:"town",
    names:["Baseline", "Days until the inactivity limit", "Already past the limit", "Survived a purge past the limit", "Premium mayor", "Share of residents active", "Residents", "Town size", "Bank", "In a nation", "Nation's risk score", "All residents checked"],
    prior:[1.0, -3.6, 1.6, -4.0, -3.0, -1.2, -0.3, 0, 0, 0, 0.5, 0.3] },
  loss7:{ label:"Nation loses a town", horizon:7, unit:"nation",
    names:["Baseline", "Share of towns ruining within 7 days", "Share of towns falling within 3 days", "Share of members active", "Change in active members", "Change in land", "Leader past the limit", "Number of towns", "Share of land overclaimable", "Lost towns last week"],
    prior:[-1.6, 6.0, 4.0, -1.5, -1.0, -0.6, 0.8, 0.9, 1.5, 1.0] },
  gain7:{ label:"Nation gains land", horizon:7, unit:"nation",
    names:["Baseline", "Change in land", "Change in active members", "Change in residents", "Gained land last week", "Number of towns", "Share of members active", "Gold per town", "Risk score"],
    prior:[-1.2, 8.0, 3.0, 2.0, 1.4, 0.6, 0.8, 0.2, -0.8] },
  diplo7:{ label:"Alliance or enmity changes", horizon:7, unit:"nation",
    names:["Baseline", "Diplomatic changes last 2 weeks", "Natural partners not yet allied", "Enemies declared last 2 weeks", "Number of allies", "Number of enemies", "Change in active members", "Hostility toward us"],
    prior:[-2.2, 1.6, 0.5, 0.8, 0.2, 0.2, 0.5, 0.3] },
  leader7:{ label:"Leadership changes", horizon:7, unit:"nation",
    names:["Baseline", "Days left before the leader's limit", "Leader activity unknown", "Share of members active", "Number of towns"],
    prior:[-2.4, -1.9, -1.0, -0.3, 0.1] },
};
const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
const dot = (w, x) => w.reduce((s, wi, i) => s + wi * (x[i] || 0), 0);
const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ML = { state:null, open:[], loaded:false };
function freshModel(key) { const m = ML_MODELS[key]; return { w:[...m.prior], g2:m.prior.map(() => 4), n:0, pos:0, sse:0, sse0:0, hits:0, hits0:0, calib:Array.from({ length:10 }, () => [0, 0]), daily:{}, recent:[] }; }
function mlState() { if (!ML.state) ML.state = { v:1, since:Date.now(), made:0, models:Object.fromEntries(Object.keys(ML_MODELS).map(k => [k, freshModel(k)])) }; return ML.state; }

// ---- features ----
function townFeatures(t) {
  const e = etaOf(t), d = e == null ? 10 : cl(e / DAY, -5, 10);
  return [1, d / 5, d < 0 ? 1 : 0, survivedPurge(t) ? 1 : 0, t.mayorPremium ? 1 : 0, t.count ? t.active / t.count : 0, Math.log1p(t.count || 0) / 3,
    Math.log1p(t.blocks || 0) / 4, Math.log1p(Math.max(0, t.balance || 0)) / 7, t.nation ? 1 : 0, t.nation ? (assess(findNation(t.nation))?.risk || 0) / 100 : 0, t.checked >= t.count ? 1 : 0];
}
const isLoss = (e, name) => (["town_ruin", "town_gone"].includes(e.type) && e.ns?.[0] === name) || (["town_switch", "town_leave"].includes(e.type) && e.from === name);
const isGain = (e, name) => (e.type === "town_new" && e.ns?.[0] === name) || (["town_switch", "town_join"].includes(e.type) && e.to === name);
function nationFeatures(n, key) {
  const a = assess(n), live = n.towns.filter(t => !t.ruined), T = Math.max(1, live.length);
  const rel = (k, base) => { const d = anyDelta(trend(n.name, k)); return d == null || !base ? 0 : cl(d / base, -1, 1); };
  const ev7 = eventsFor(n.name, 7), ev14 = eventsFor(n.name, 14);
  const activeRate = a.activeRate ?? 0.5, logT = Math.log1p(live.length) / 3;
  if (key === "loss7") return [1, ruinsWithin(n, 7).length / T, live.filter(isSoon).length / T, activeRate, rel("a30", n.active30), rel("chunks", n.chunks), a.leaderGone ? 1 : 0, logT, cl(a.take / Math.max(1, n.chunks), 0, 1), ev7.some(e => isLoss(e, n.name)) ? 1 : 0];
  if (key === "gain7") return [1, rel("chunks", n.chunks), rel("a30", n.active30), rel("res", n.residents), ev7.some(e => isGain(e, n.name) || (e.type === "land" && e.d > 0 && e.ns?.[0] === n.name)) ? 1 : 0, logT, activeRate, Math.log1p(goldOf(n) / T) / 8, a.risk / 100];
  if (key === "diplo7") {
    const churn = ev14.filter(e => /^(ally|enemy)_/.test(e.type) && e.ns[0] === n.name).length;
    const partners = nations.filter(m => m !== n && !n.allies.includes(m.name) && !n.enemies.includes(m.name) && m.enemies.filter(x => n.enemies.includes(x)).length + m.allies.filter(x => n.allies.includes(x)).length >= 2).length;
    return [1, cl(churn / 3, 0, 2), cl(partners / 3, 0, 2), cl(ev14.filter(e => e.type === "enemy_add" && e.ns[0] === n.name).length / 2, 0, 2), cl(n.allies.length / 5, 0, 2), cl(n.enemies.length / 5, 0, 2), rel("a30", n.active30), a.hostility / 100];
  }
  const left = n.kingLast != null ? days() - (Date.now() - n.kingLast) / DAY : null;
  return [1, left == null ? 0 : cl(left, -7, 30) / 7, left == null ? 1 : 0, activeRate, logT];
}
const featuresFor = (key, subj) => key === "ruin72" ? townFeatures(subj) : nationFeatures(subj, key);
function mlPredict(key, x) { return sigmoid(dot(mlState().models[key].w, x)); }
function mlPrior(key, x) { return sigmoid(dot(ML_MODELS[key].prior, x)); }
// the model's current probability for a subject, and how much it has learned
function mlNow(key, subj) {
  if (!subj) return null;
  const m = mlState().models[key];
  return { p:mlPredict(key, featuresFor(key, subj)), n:m.n, skill:m.n ? 1 - m.sse / Math.max(1e-9, m.sse0) : null };
}

// ---- outcomes ----
function outcomeOf(pr, evs, now) {
  const after = evs.filter(e => e.at > pr.at);
  let hit = false;
  if (pr.model === "ruin72") hit = after.some(e => (e.type === "town_ruin" || e.type === "town_gone") && e.town === pr.subject) || !!towns.find(t => t.name === pr.subject && t.ruined);
  else {
    const mine = after.filter(e => (e.ns || []).includes(pr.subject));
    if (pr.model === "loss7") hit = mine.some(e => isLoss(e, pr.subject)) || mine.some(e => e.type === "nation_gone");
    if (pr.model === "gain7") hit = mine.some(e => isGain(e, pr.subject)) || mine.filter(e => e.type === "land" && e.d > 0 && e.ns[0] === pr.subject).reduce((s, e) => s + e.d, 0) >= 16;
    if (pr.model === "diplo7") hit = mine.some(e => /^(ally|enemy)_/.test(e.type) && e.ns[0] === pr.subject);
    if (pr.model === "leader7") hit = mine.some(e => e.type === "leader_change" && e.ns[0] === pr.subject);
  }
  if (hit) return 1;
  return now >= pr.due ? 0 : null; // window still open and nothing yet
}
// one learning step on a resolved forecast (the model is scored on what it said before it knew)
function learn(pr, y) {
  const m = mlState().models[pr.model], lr = 0.35, l2 = 1e-3;
  const p = mlPredict(pr.model, pr.x);
  m.w = m.w.map((w, i) => { const g = cl((p - y) * (pr.x[i] || 0) + l2 * w, -5, 5); m.g2[i] += g * g; return w - lr * g / Math.sqrt(m.g2[i]); });
  m.n++; m.pos += y; m.sse += (pr.p - y) ** 2; m.sse0 += (pr.p0 - y) ** 2; m.hits += (pr.p >= 0.5) === !!y; m.hits0 += (pr.p0 >= 0.5) === !!y;
  const b = Math.min(9, Math.floor(pr.p * 10)); m.calib[b][0]++; m.calib[b][1] += y;
  const day = new Date().toISOString().slice(0, 10), dd = m.daily[day] ||= [0, 0, 0]; dd[0]++; dd[1] += (pr.p - y) ** 2; dd[2] += (pr.p0 - y) ** 2;
  const keys = Object.keys(m.daily).sort(); if (keys.length > 120) delete m.daily[keys[0]];
  m.recent.push([Date.now(), pr.subject, Math.round(pr.p * 1000) / 1000, Math.round(pr.p0 * 1000) / 1000, y]); if (m.recent.length > 300) m.recent.shift();
}

// ---- after each scan: resolve what's due, then forecast afresh ----
async function mlScan() {
  if (!nations.length || !ML.loaded) return;
  const now = Date.now(), st = mlState();
  const oldest = Math.min(now, ...ML.open.map(p => p.at));
  const evs = ARCHIVE.events.filter(e => e.at >= oldest);
  const resolved = [];
  for (const pr of ML.open) { const y = outcomeOf(pr, evs, now); if (y == null) continue; learn(pr, y); pr.status = "done"; pr.y = y; pr.resolvedAt = now; resolved.push(pr); }
  ML.open = ML.open.filter(p => p.status === "open");
  // new forecasts: one open forecast per subject and model at a time
  const have = new Set(ML.open.map(p => p.model + "|" + p.subject)), made = [];
  const add = (key, subj, name) => {
    if (have.has(key + "|" + name)) return;
    const x = featuresFor(key, subj), pr = { model:key, subject:name, at:now, due:now + ML_MODELS[key].horizon * DAY, x, p:mlPredict(key, x), p0:mlPrior(key, x), status:"open" };
    made.push(pr); have.add(key + "|" + name);
  };
  const live = towns.filter(t => !t.ruined && t.c);
  const atRisk = live.filter(t => { const e = etaOf(t); return e != null && e < 7 * DAY; }).sort((a, b) => etaOf(a) - etaOf(b)).slice(0, 300);
  const others = live.filter(t => !atRisk.includes(t)).sort(() => Math.random() - 0.5).slice(0, 30); // negatives keep it calibrated
  for (const t of [...atRisk, ...others]) add("ruin72", t, t.name);
  for (const n of nations) for (const key of ["loss7", "gain7", "diplo7", "leader7"]) add(key, n, n.name);
  st.made += made.length;
  try {
    await idbDo(["predictions", "meta"], "readwrite", tx => {
      const ps = tx.objectStore("predictions");
      for (const pr of resolved) ps.put(pr);
      for (const pr of made) { const r = ps.add(pr); r.onsuccess = () => { pr.id = r.result; }; }
      tx.objectStore("meta").put(st, "ml");
    });
  } catch (e) { console.warn("Forecast Lab couldn't save:", e); }
  ML.open.push(...made);
  if (resolved.length || made.length) console.info(`Forecast Lab: ${resolved.length} forecasts checked, ${made.length} made`);
}
async function loadML() {
  try {
    await idbDo(["predictions", "meta"], "readonly", async tx => {
      ML.state = (await reqP(tx.objectStore("meta").get("ml"))) || null;
      ML.open = await reqP(tx.objectStore("predictions").index("status").getAll("open"));
    });
    // keep the model list in step if models were added since the state was saved
    const st = mlState(); for (const k of Object.keys(ML_MODELS)) if (!st.models[k] || st.models[k].w.length !== ML_MODELS[k].prior.length) st.models[k] = freshModel(k);
    ML.loaded = true;
  } catch (e) { console.warn("Forecast Lab unavailable:", e); }
}
async function recentResolved(limit = 40) {
  try { return await idbDo(["predictions"], "readonly", async tx => (await reqP(tx.objectStore("predictions").index("status").getAll("done"))).sort((a, b) => b.resolvedAt - a.resolvedAt).slice(0, limit)); } catch { return []; }
}
const skillOf = m => m.n ? 1 - m.sse / Math.max(1e-9, m.sse0) : null;
