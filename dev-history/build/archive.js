/* ---------- Intelligence archive (IndexedDB) ----------
   Every finished scan is kept permanently in this browser:
   - series:  per nation, one point per scan (thinned with age: everything for 3 days, then one per
              3 hours to 30 days, then one per day), for trends and forecasts
   - frames:  a daily snapshot of every town and every nation's alliances, for "then vs now"
   - events:  what changed between consecutive scans (towns founded, ruined, deleted or switching
              nation; land gained or lost; alliances and enmities made or broken; leaders replaced)
   - meta:    the last full scan, so the site opens instantly with data, and the latest frame
   Watch mode rescans on a timer, so a computer left running keeps collecting around the clock. */
const IDB_NAME = "bh-intel", PT = { at:0, a30:1, a7:2, res:3, towns:4, chunks:5, gold:6, allies:7, enemies:8, falling:9, take:10, dHQ:11, cx:12, cz:13 };
let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise((res, rej) => {
    let req; try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { return rej(e); }
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("meta"); d.createObjectStore("series"); d.createObjectStore("frames");
      d.createObjectStore("events", { autoIncrement:true }).createIndex("at", "at");
    };
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
  return idbP;
}
const idbDo = (stores, mode, fn) => idb().then(d => new Promise((res, rej) => {
  const tx = d.transaction(stores, mode); let out; Promise.resolve(fn(tx)).then(v => { out = v; });
  tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
}));
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// in memory after load: every nation's series, the last 60 days of events, archive stats
const ARCHIVE = { series:new Map(), events:[], frame:null, scans:0, first:null, last:null, ready:false };
async function loadArchive() {
  try {
    await idbDo(["meta", "series", "events"], "readonly", async tx => {
      const all = await reqP(tx.objectStore("series").getAll());
      for (const s of all) ARCHIVE.series.set(s.name, s.pts);
      const st = (await reqP(tx.objectStore("meta").get("stats"))) || {};
      Object.assign(ARCHIVE, { scans:st.scans || 0, first:st.first || null, last:st.last || null });
      ARCHIVE.frame = await reqP(tx.objectStore("meta").get("frame")) || null;
      const since = Date.now() - 60 * 864e5;
      ARCHIVE.events = await reqP(tx.objectStore("events").index("at").getAll(IDBKeyRange.lowerBound(since)));
    });
    ARCHIVE.ready = true;
  } catch (e) { console.warn("Archive unavailable:", e); }
}

// a compact picture of the world right now: every town, and every nation's alliances
function makeFrame() {
  const t = {}, n = {};
  for (const x of towns) t[x.name] = { na:x.nation || "", x:x.c?.x ?? null, z:x.c?.z ?? null, b:x.blocks ?? 0, ru:x.ruined ? 1 : 0, m:x.mayor || "", r:x.count || 0 };
  for (const x of nations) n[x.name] = { al:x.allies, en:x.enemies, k:x.king || "", cap:x.capital || "" };
  return { at:Date.now(), t, n };
}
// what changed between two frames
function diffFrames(prev, cur) {
  const ev = [], at = cur.at, E = o => ev.push({ at, ...o });
  for (const [name, c] of Object.entries(cur.t)) {
    const p = prev.t[name];
    if (!p) { E({ type:"town_new", ns:[c.na].filter(Boolean), town:name, x:c.x, z:c.z }); continue; }
    if (p.na !== c.na) {
      if (p.na && c.na) E({ type:"town_switch", ns:[p.na, c.na], town:name, from:p.na, to:c.na, x:c.x, z:c.z });
      else if (c.na) E({ type:"town_join", ns:[c.na], town:name, to:c.na, x:c.x, z:c.z });
      else E({ type:"town_leave", ns:[p.na], town:name, from:p.na, x:c.x, z:c.z });
    }
    if (!p.ru && c.ru) E({ type:"town_ruin", ns:[p.na || c.na].filter(Boolean), town:name, x:c.x, z:c.z });
    if (Math.abs(c.b - p.b) >= 8) E({ type:"land", ns:[c.na].filter(Boolean), town:name, d:c.b - p.b, x:c.x, z:c.z });
    if (p.m && c.m && p.m !== c.m && c.r >= 3) E({ type:"mayor_change", ns:[c.na].filter(Boolean), town:name, from:p.m, to:c.m });
  }
  for (const [name, p] of Object.entries(prev.t)) if (!cur.t[name]) E({ type:"town_gone", ns:[p.na].filter(Boolean), town:name, x:p.x, z:p.z });
  for (const [name, c] of Object.entries(cur.n)) {
    const p = prev.n[name];
    if (!p) { E({ type:"nation_new", ns:[name] }); continue; }
    for (const a of c.al) if (!p.al.includes(a)) E({ type:"ally_add", ns:[name, a], who:a });
    for (const a of p.al) if (!c.al.includes(a)) E({ type:"ally_drop", ns:[name, a], who:a });
    for (const a of c.en) if (!p.en.includes(a)) E({ type:"enemy_add", ns:[name, a], who:a });
    for (const a of p.en) if (!c.en.includes(a)) E({ type:"enemy_drop", ns:[name, a], who:a });
    if (p.k && c.k && p.k !== c.k) E({ type:"leader_change", ns:[name], from:p.k, to:c.k });
    if (p.cap && c.cap && p.cap !== c.cap) E({ type:"capital_change", ns:[name], from:p.cap, to:c.cap });
  }
  for (const name of Object.keys(prev.n)) if (!cur.n[name]) E({ type:"nation_gone", ns:[name] });
  return ev;
}
// thin a series with age so a year of scans stays small
function compact(pts, now) {
  const out = [], seen = new Set();
  for (let i = pts.length - 1; i >= 0; i--) {
    const age = now - pts[i][0];
    const bucket = age < 3 * 864e5 ? "r" + i : age < 30 * 864e5 ? "h" + Math.floor(pts[i][0] / (3 * 36e5)) : "d" + Math.floor(pts[i][0] / 864e5);
    if (seen.has(bucket)) continue; seen.add(bucket); out.push(pts[i]);
  }
  return out.reverse();
}
function nationPoint(n, homeTowns) {
  const live = n.towns.filter(t => !t.ruined && t.c);
  const cx = live.length ? Math.round(live.reduce((s, t) => s + t.c.x, 0) / live.length) : null, cz = live.length ? Math.round(live.reduce((s, t) => s + t.c.z, 0) / live.length) : null;
  let dHQ = null;
  if (homeTowns.length && !homeTowns.includes(live[0])) for (const t of live) for (const h of homeTowns) { const d = Math.hypot(t.c.x - h.c.x, t.c.z - h.c.z); if (dHQ == null || d < dHQ) dHQ = d; }
  return [Date.now(), n.active30, n.active7, n.residents, live.length, n.chunks, Math.round(goldOf(n)), n.allies.length, n.enemies.length,
    live.filter(isSoon).length, live.reduce((s, t) => s + (overclaim(t)?.takeable || 0), 0), dHQ == null ? null : Math.round(dHQ), cx, cz];
}
// store one finished scan
async function archiveScan(full) {
  if (!nations.length) return;
  try {
    const now = Date.now(), cur = makeFrame(), prev = ARCHIVE.frame;
    const events = prev ? diffFrames(prev, cur) : [];
    const home = findNation($("myNation").value), homeTowns = home ? home.towns.filter(t => !t.ruined && t.c) : [];
    const day = new Date(now).toISOString().slice(0, 10);
    await idbDo(["meta", "series", "frames", "events"], "readwrite", tx => {
      const ser = tx.objectStore("series");
      for (const n of nations) {
        const pts = compact([...(ARCHIVE.series.get(n.name) || []), nationPoint(n, n === home ? [] : homeTowns)], now);
        ARCHIVE.series.set(n.name, pts); ser.put({ name:n.name, pts }, n.name);
      }
      const ev = tx.objectStore("events"); for (const e of events) ev.add(e);
      tx.objectStore("frames").put(cur, day);
      tx.objectStore("meta").put(cur, "frame");
      ARCHIVE.scans++; ARCHIVE.first ||= now; ARCHIVE.last = now;
      tx.objectStore("meta").put({ scans:ARCHIVE.scans, first:ARCHIVE.first, last:now }, "stats");
      tx.objectStore("meta").put({ at:now, ...full }, "lastScan");
    });
    ARCHIVE.frame = cur; ARCHIVE.events.push(...events);
    if (events.length) console.info(`Archive: ${events.length} events logged`);
  } catch (e) { console.warn("Couldn't archive this scan:", e); }
}
// the town frame nearest to a moment in the past (daily frames)
async function frameNear(ts) {
  try { return await idbDo(["frames"], "readonly", async tx => {
    const keys = await reqP(tx.objectStore("frames").getAllKeys());
    if (!keys.length) return null;
    const want = new Date(ts).toISOString().slice(0, 10);
    const key = keys.filter(k => k <= want).pop() || keys[0];
    return reqP(tx.objectStore("frames").get(key));
  }); } catch { return null; }
}
async function archiveSize() { try { const e = await navigator.storage?.estimate?.(); return e?.usage || null; } catch { return null; } }
async function exportArchive() {
  const data = await idbDo(["meta", "series", "frames", "events"], "readonly", async tx => ({
    kind:"bleeding-heart-archive", v:1, exported:Date.now(),
    stats:await reqP(tx.objectStore("meta").get("stats")), series:await reqP(tx.objectStore("series").getAll()),
    frameKeys:await reqP(tx.objectStore("frames").getAllKeys()), frames:await reqP(tx.objectStore("frames").getAll()),
    events:await reqP(tx.objectStore("events").getAll()),
  }));
  const blob = new Blob([JSON.stringify(data)], { type:"application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bleeding-heart-intel-archive-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// merge another archive (another computer's, or a backup) into this one
async function importArchive(file) {
  const j = JSON.parse(await file.text());
  if (j?.kind !== "bleeding-heart-archive") throw new Error("That file isn't an intelligence archive.");
  await idbDo(["meta", "series", "frames", "events"], "readwrite", async tx => {
    const ser = tx.objectStore("series");
    for (const s of j.series || []) {
      if (!s?.name || !Array.isArray(s.pts)) continue;
      const merged = [...(ARCHIVE.series.get(s.name) || []), ...s.pts.filter(p => Array.isArray(p) && typeof p[0] === "number")].sort((a, b) => a[0] - b[0]);
      const pts = compact(merged.filter((p, i) => !i || p[0] !== merged[i - 1][0]), Date.now());
      ARCHIVE.series.set(s.name, pts); ser.put({ name:s.name, pts }, s.name);
    }
    const fr = tx.objectStore("frames"); (j.frameKeys || []).forEach((k, i) => { if (/^\d{4}-\d{2}-\d{2}$/.test(k) && j.frames[i]?.t) fr.put(j.frames[i], k); });
    const have = new Set(ARCHIVE.events.map(e => e.at + e.type + (e.town || "") + (e.ns || []).join()));
    const ev = tx.objectStore("events");
    for (const e of j.events || []) if (e?.type && typeof e.at === "number" && !have.has(e.at + e.type + (e.town || "") + (e.ns || []).join())) { ev.add(e); if (e.at > Date.now() - 60 * 864e5) ARCHIVE.events.push(e); }
    const st = j.stats || {};
    ARCHIVE.scans += st.scans || 0; ARCHIVE.first = Math.min(ARCHIVE.first || Infinity, st.first || Infinity); ARCHIVE.last = Math.max(ARCHIVE.last || 0, st.last || 0);
    tx.objectStore("meta").put({ scans:ARCHIVE.scans, first:ARCHIVE.first, last:ARCHIVE.last }, "stats");
  });
  ARCHIVE.events.sort((a, b) => a.at - b.at);
}

// ---- watch mode: rescan on a timer while the page is open ----
const WATCH = { on:false, every:30, next:null, timer:0 };
try { Object.assign(WATCH, JSON.parse(localStorage.getItem("rh_watch") || "{}"), { next:null, timer:0 }); } catch {}
function scheduleWatch() {
  clearTimeout(WATCH.timer); WATCH.next = null;
  if (!WATCH.on) return renderWatch();
  const last = ARCHIVE.last || 0, due = Math.max(Date.now() + 5000, last + WATCH.every * 6e4);
  WATCH.next = due;
  WATCH.timer = setTimeout(() => { if (!scanning) scan(); else scheduleWatch(); }, due - Date.now());
  renderWatch();
}
function renderWatch() {
  const el = $("watchState"); if (!el) return;
  el.textContent = !WATCH.on ? "off" : scanning ? "scanning now" : WATCH.next ? `next scan in ${fmtDur(Math.max(0, WATCH.next - Date.now()))}` : "on";
}
setInterval(renderWatch, 1000);
