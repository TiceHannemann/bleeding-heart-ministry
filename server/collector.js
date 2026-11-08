// The collector: records live positions continuously and scans every hour.
// Rather than rewrite the intelligence system for Node, it opens the ministries' own page in headless
// Chromium, presses Scan, and lets the page do everything it already does: archive the scan, diff
// events, run the Forecast Lab, and write the Briefing Room documents. The browser profile lives on
// the data volume, so the page's IndexedDB archive keeps growing from one hour to the next.
// After each scan the archive is exported for visitors' browsers and the reports are saved as PDFs.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DATA, readJSON, writeJSON } = require("./paths");
const signals = require("./signals");
const finance = require("./finance");
const keyed = require("./keyed");
const emc = require("./emc");
const history = require("./history");
const population = require("./population");
const combat = require("./combat");

const RUNS = path.join(DATA, "runs"), IMPORTS = path.join(DATA, "imports"), PROFILE = path.join(DATA, "profile");
const STATUS_FILE = path.join(DATA, "status.json");
const SCAN_TIMEOUT = 25 * 6e4;

const S = Object.assign({ running:false, lastRun:null, lastOk:null, lastError:null, nextRun:null, archiveVersion:null, scans:0, history:[] }, readJSON(STATUS_FILE) || {}, { running:false, fails:0 });
const save = () => { try { writeJSON(STATUS_FILE, S); } catch (e) { console.warn("status not saved:", e.message); } };
const tokens = new Map();
let opts = { port:8080, everyMin:60 }, timer = 0;

function tokenOk(t) {
  const exp = tokens.get(t);
  if (!exp) return false;
  tokens.delete(t); // one use only
  return exp > Date.now();
}
// the container's memory, from its cgroup (Linux only): in use (less file cache the kernel can drop, as docker stats
// counts it), the limit, and how many times the kernel has killed a process for lack of it since the container started
const mb = b => Math.round(b / 1048576);
function memory() {
  const rd = f => { try { return fs.readFileSync("/sys/fs/cgroup/" + f, "utf8").trim(); } catch { return null; } };
  const v2 = rd("memory.current") != null, num = v => /^\d+$/.test(v || "") ? +v : null;
  const used = num(v2 ? rd("memory.current") : rd("memory/memory.usage_in_bytes"));
  if (used == null) return null;
  const limit = num(v2 ? rd("memory.max") : rd("memory/memory.limit_in_bytes"));
  const cache = +((v2 ? rd("memory.stat") : rd("memory/memory.stat")) || "").match(v2 ? /^inactive_file (\d+)/m : /^total_inactive_file (\d+)/m)?.[1] || 0;
  const oomKills = +((v2 ? rd("memory.events") : rd("memory/memory.oom_control")) || "").match(/oom_kill (\d+)/)?.[1] || 0;
  return { usedMB:mb(used - cache), limitMB:limit && limit < 2 ** 50 ? mb(limit) : null, oomKills };
}
function status() { const { history, ...s } = S; return { ...s, memory:memory(), recent:history.slice(-24), signals:signals.status(), finance:finance.status(), keyed:keyed.status(), population:population.status(), combat:combat.status() }; }

function schedule() {
  clearTimeout(timer);
  // line up with the clock: a few minutes past each interval, so reports land at predictable times
  const every = opts.everyMin * 6e4, now = Date.now();
  let due = Math.ceil((now - 3 * 6e4) / every) * every + 3 * 6e4;
  // if the last good scan is older than an interval (first boot, or after downtime), scan straight away. After a
  // failure, wait ten minutes, then twenty, then forty, up to the interval: a scan that keeps failing must not run
  // back to back, which holds the CPU at full load and gets the VPS throttled
  if (!S.lastOk || now - S.lastOk > every) due = now + (S.fails ? Math.min(every, 10 * 6e4 * 2 ** (S.fails - 1)) : 15e3);
  S.nextRun = due; save();
  timer = setTimeout(async () => { await runOnce(); schedule(); }, due - now);
}
function start(o) {
  opts = { ...opts, ...o }; schedule();
  // the finance deep scan (every player and quarter) runs between hourly scans; when it finishes, visitors get it straight away
  // its player records also feed the Ministry of Population
  finance.start({ busy:() => S.running, after:refresh, onPlayers:(recs, at, prev) => { const r = population.ingest(recs, at, prev); console.log(`population: ${r.players} players, ${r.moves} moved between nations`); } });
  // with an EarthMC API key: leaderboards, pursuits and the event stream. Towns fall at the new day, so a scan
  // follows a few minutes after it, once nothing else is running, and fresh ruins show straight away.
  keyed.start({ busy:() => S.running || finance.status().running, onNewDay:() => {
    const t0 = Date.now(), DELAY = (+process.env.NEWDAY_DELAY_S || 180) * 1000;
    const go = () => { if (S.running || finance.status().running) { if (Date.now() - t0 < 30 * 6e4) setTimeout(go, 3e4); return; }
      console.log("collector: new day; scanning for fresh ruins"); S.newDayScan = Date.now(); runSoon(); };
    setTimeout(go, DELAY);
  } });
  // open the browser straight away so live positions are recorded from the start, not only after the first scan
  setTimeout(() => { if (!S.running) browser().catch(e => console.error("collector: browser failed to open:", e.message)); }, 2000);
  // check every few minutes that tracking is still running (the browser reopens itself after a crash or its daily restart)
  setInterval(() => { if (!S.running && !B.opening) browser().then(p => p.evaluate(() => ({ polls:MOVES.polls, lastOk:MOVES.lastOk, err:MOVES.err, visits:MOVES.visits.length })))
    .then(m => { S.moves = m; }).catch(() => {}); }, 5 * 6e4).unref();
}
// new figures for visitors between scans (a finished finance scan, an uploaded history): no scan, just the archive again
async function refresh() {
  if (S.running) return;
  S.running = true;
  try { const page = await browser(); await pushSignals(page, signals.events()); await pushFinance(page); await pushKeyed(page); await pushHistory(page); await pushPeople(page); await exportArchive(page); }
  catch (e) { console.warn("collector: refresh failed:", e.message); }
  finally { S.running = false; save(); }
}
const pushSignals = (page, ev) => page.evaluate(ev => { SIGNALS = ev; return idbDo(["meta"], "readwrite", tx => tx.objectStore("meta").put(ev, "signals")); }, ev);
function runSoon() { if (S.running) return; clearTimeout(timer); S.nextRun = Date.now() + 1000; timer = setTimeout(async () => { await runOnce(); schedule(); }, 1000); }

const stamp = d => d.toISOString().slice(0, 16).replace(/[-:]/g, "") + "Z"; // 20261031T1403Z
const slug = s => String(s).replace(/[^\w-]+/g, "_").slice(0, 60);

// The collector's browser stays open all the time: between scans its page records live positions
// (Movement Watch, through the server's /api/players relay). It is restarted once a day, and after a crash.
const B = { ctx:null, page:null, started:0, opening:null, logs:[] };
const RESTART_MS = 24 * 36e5;
async function closeBrowser() { const c = B.ctx; Object.assign(B, { ctx:null, page:null }); try { await c?.close(); } catch {} }
function browser() {
  if (B.page && !B.page.isClosed() && Date.now() - B.started < RESTART_MS) return Promise.resolve(B.page);
  return B.opening ||= (async () => {
    await closeBrowser();
    const { chromium } = require("playwright");
    const ctx = await chromium.launchPersistentContext(PROFILE, { headless:true, viewport:{ width:1280, height:900 },
      args:["--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--mute-audio", "--no-first-run"],
      ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) }); // e.g. "msedge" to use an installed browser locally
    // map tiles, skins and web fonts aren't needed to scan or to write PDFs
    await ctx.route(/map\.earthmc\.net\/tiles\/.*\.png|mc-heads\.net|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    if (global.__collectorRoutes) await global.__collectorRoutes(ctx); // tests install a fake EarthMC API here
    await emc.keyPage(ctx); // the page's API requests get the key on their way out (after the routes above, so it runs first)
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on("pageerror", e => { B.logs.push("page error: " + e.message); B.logs = B.logs.slice(-20); });
    // a crashed or closed browser is shut down and reopened in half a minute, so position tracking resumes by itself.
    // Shutting it down matters: a crashed page leaves Chromium running, holding memory and the profile's lock
    const lost = why => () => { if (B.page !== page) return; console.warn(`collector: browser ${why}; reopening`);
      B.lost = { at:Date.now(), why }; Object.assign(B, { ctx:null, page:null }); ctx.close().catch(() => {});
      setTimeout(() => browser().catch(e => console.error("collector: reopen failed:", e.message)), 30e3); };
    page.on("crash", lost("crashed")); ctx.on("close", lost("closed"));
    await page.addInitScript(() => {
      window.BH_COLLECTOR = true;
      // nobody looks at this page, so it says it is hidden: the globe stops redrawing sixty times a second and the
      // live pages stop rebuilding, while scans, position tracking, the Forecast Lab and the reports carry on
      Object.defineProperty(document, "hidden", { get:() => true, configurable:true });
      Object.defineProperty(document, "visibilityState", { get:() => "hidden", configurable:true });
      try { sessionStorage.setItem("bh_unlocked", '["attack","intel"]'); sessionStorage.setItem("rh_booted", "1"); } catch {}
    });
    const token = crypto.randomBytes(24).toString("hex");
    tokens.set(token, Date.now() + 5 * 6e4);
    await page.goto(`http://127.0.0.1:${opts.port}/gov?ct=${token}#moves`, { waitUntil:"domcontentloaded", timeout:120e3 });
    await page.waitForFunction(() => typeof appReady !== "undefined" && typeof scan === "function", null, { timeout:60e3 });
    await page.evaluate(home => appReady.then(() => {
      if (home) $("myNation").value = home;
      // note when the Forecast Lab has finished with each scan
      const ml = mlScan; mlScan = async (...a) => { try { return await ml(...a); } finally { window.__mlDone = Date.now(); } };
    }), process.env.HOME_NATION || "");
    Object.assign(B, { ctx, page, started:Date.now() });
    console.log("collector: browser open; recording live positions");
    return page;
  })().finally(() => { B.opening = null; });
}

// the archive, for visitors' browsers: what their pages use, including the last scan and the Forecast Lab.
// The server keeps every daily frame and event; visitors get the frames of the last ten days (the page compares
// with a week ago), the events of the last sixty (all the page loads) and the Forecast Lab's open and latest checked
// forecasts, so the export stops growing every day.
// It is written a part at a time and a slice at a time: the page reads one part of its archive (the last scan, the
// series, the events...), the server asks for it a few hundred records at a time and compresses them as they
// arrive, and the page lets that part go before reading the next. Built as one string it sat in memory several times
// over (every part at once in the page, the string, its copy in transit and here), which on a full server was
// enough to run the container out of memory.
const SLICE = 400;
const PARTS = ["stats", "frame", "lastScan", "ml", "signals", "finance", "keyed", "history", "population", "combat", "tracks",
  "series", "frameKeys", "frames", "events", "visits", "predictions"];
async function exportArchive(page) {
  const gz = path.join(DATA, "archive.json.gz"), tmp = gz + ".tmp";
  const out = zlib.createGzip({ level:6 }), file = fs.createWriteStream(tmp);
  const finished = new Promise((res, rej) => { file.on("finish", res); file.on("error", rej); out.on("error", rej); });
  out.pipe(file);
  const put = s => out.write(s) ? null : new Promise(r => out.once("drain", r));
  // read one part into the page and say how to fetch it: long arrays in slices, an object's fields one by one
  // (a map with many keys, such as names to last logins, is small per key and goes whole)
  const load = k => page.evaluate(k => idbDo(["meta", "series", "frames", "events", "visits", "predictions"], "readonly", async tx => {
    const m = tx.objectStore("meta"), recent = IDBKeyRange.lowerBound(new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10));
    // the Forecast Lab's open forecasts and its latest checked ones (visitors' pages show thirty), not every forecast
    // it has ever made, which grows by hundreds a day; what the checked ones taught the models is in its state ("ml")
    const forecasts = async () => { const ix = tx.objectStore("predictions").index("status"), done = [];
      await new Promise((res, rej) => { const c = ix.openCursor(IDBKeyRange.only("done"), "prev");
        c.onsuccess = e => { const r = e.target.result; if (r && done.length < 200) { done.push(r.value); r.continue(); } else res(); }; c.onerror = () => rej(c.error); });
      return [...done, ...await reqP(ix.getAll("open"))].sort((a, b) => a.id - b.id); };
    const v = k === "predictions" ? await forecasts() : await reqP(k === "series" ? tx.objectStore("series").getAll() : k === "frameKeys" ? tx.objectStore("frames").getAllKeys(recent)
      : k === "frames" ? tx.objectStore("frames").getAll(recent) : k === "events" ? tx.objectStore("events").index("at").getAll(IDBKeyRange.lowerBound(Date.now() - 60 * 864e5))
      : k === "visits" ? tx.objectStore("visits").getAll() : m.get(k));
    window.__exp = { [k]:v };
    if (v === undefined) return null;
    const len = x => Array.isArray(x) ? x.length : -1, obj = x => x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length <= 64;
    return [len(v), obj(v) ? Object.keys(v).filter(j => v[j] !== undefined).map(j => [j, len(v[j])]) : null];
  }), k);
  const piece = p => page.evaluate(p => JSON.stringify(p.reduce((o, k) => o[k], window.__exp)), p);
  const slices = async (p, n) => { await put("["); for (let i = 0; i < n; i += SLICE)
    await put((i ? "," : "") + await page.evaluate(([p, i, s]) => JSON.stringify(p.reduce((o, k) => o[k], window.__exp).slice(i, i + s)).slice(1, -1), [p, i, SLICE])); await put("]"); };
  const value = (p, n) => n > SLICE ? slices(p, n) : piece(p).then(put);
  try {
    await put(JSON.stringify({ kind:"bleeding-heart-archive", v:1, server:true, exported:Date.now() }).slice(0, -1));
    for (const k of PARTS) {
      const shape = await load(k);
      if (shape) {
        const [n, sub] = shape;
        await put("," + JSON.stringify(k) + ":");
        if (!sub) await value([k], n);
        else { await put("{"); for (const [j, [s, m]] of sub.entries()) { await put((j ? "," : "") + JSON.stringify(s) + ":"); await value([k, s], m); } await put("}"); }
      }
      await page.evaluate(() => { delete window.__exp; });
    }
    await put("}"); out.end(); await finished;
    fs.renameSync(tmp, gz);
  } catch (e) { out.destroy(); file.destroy(); finished.catch(() => {}); throw e; }
  finally { await page.evaluate(() => { delete window.__exp; }).catch(() => {}); }
  S.archiveVersion = String(Date.now()); save();
}
// banks come from the page's own scan (no extra requests); finance.js adds players, flows and property
async function pushFinance(page) {
  const input = await page.evaluate(() => scanData?.details ? {
    towns:scanData.details.map(t => { const c = coordsOf(t); return [t.name, t.nation?.name || null, t.stats?.balance ?? 0, t.stats?.forSalePrice ?? null, c?.x ?? null, c?.z ?? null, t.stats?.numResidents ?? (t.residents || []).length]; }),
    nations:Object.values(nationDetails || {}).map(n => [n.name, n.stats?.balance ?? 0]),
  } : null);
  if (!input) return;
  const fin = finance.hourly(input);
  await page.evaluate(f => { FIN = f; return idbDo(["meta"], "readwrite", tx => tx.objectStore("meta").put(f, "finance")); }, fin);
}
// leaderboards, pursuits and the key owner's own shops and books (nothing when no API key is set)
async function pushKeyed(page) {
  const k = keyed.snapshot();
  await page.evaluate(k => { KEYED = k; return idbDo(["meta"], "readwrite", tx => k ? tx.objectStore("meta").put(k, "keyed") : tx.objectStore("meta").delete("keyed")); }, k);
}
// the history of Terra Nostra, when one has been uploaded
async function pushHistory(page) {
  const h = history.get();
  await page.evaluate(h => { HISTORY = h; return idbDo(["meta"], "readwrite", tx => h ? tx.objectStore("meta").put(h, "history") : tx.objectStore("meta").delete("history")); }, h);
}
// the Ministry of Population's picture, and who has been killing whom (nations as of the latest player scan)
async function pushPeople(page) {
  const p = population.snapshot(), c = combat.snapshot(population.nationOf);
  await page.evaluate(([p, c]) => { POP = p; COMBAT = c; return idbDo(["meta"], "readwrite", tx => { const m = tx.objectStore("meta");
    p ? m.put(p, "population") : m.delete("population"); c ? m.put(c, "combat") : m.delete("combat"); }); }, [p, c]);
}

async function runOnce() {
  if (S.running) return;
  S.running = true; S.lastRun = Date.now(); save();
  // never on top of the finance scan (forty-five thousand players): a scan retried after a failure can fall due at
  // any minute, and the two together need more memory than either alone. S.running stops a new one starting meanwhile
  for (let i = 0; finance.status().running && i < 60; i++) await new Promise(r => setTimeout(r, 30e3));
  const t0 = Date.now(), oom0 = memory()?.oomKills || 0;
  // the most memory the scan needed, sampled every few seconds, so the limit can be set from experience
  let peak = 0; const sample = setInterval(() => { peak = Math.max(peak, memory()?.usedMB || 0); }, 5e3);
  try {
    const page = await browser();
    const logs = B.logs.splice(0);

    // merge archives uploaded from browsers (earlier Watch mode collection)
    fs.mkdirSync(IMPORTS, { recursive:true });
    for (const f of fs.readdirSync(IMPORTS).filter(f => f.endsWith(".json")).sort()) {
      const file = path.join(IMPORTS, f);
      try {
        await page.evaluate(txt => importArchive({ text:async () => txt }), fs.readFileSync(file, "utf8"));
        fs.renameSync(file, file + ".merged");
        console.log("collector: merged import", f);
      } catch (e) { console.warn("collector: import failed", f, e.message); fs.renameSync(file, file + ".failed"); }
    }

    // scan, resuming up to three times if the API pushes back
    const before = await page.evaluate(() => { window.__mlDone = 0; return ARCHIVE.last || 0; });
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      if (attempt) await page.waitForTimeout(60e3);
      await page.evaluate(() => { scan(); });
      await page.waitForFunction(() => !scanning, null, { timeout:SCAN_TIMEOUT, polling:2000 });
      ok = await page.evaluate(b => (ARCHIVE.last || 0) > b, before);
      if (!ok) console.warn("collector: scan paused:", await page.textContent("#status"));
    }
    if (!ok) throw new Error("Scan did not complete: " + (await page.textContent("#status")).slice(0, 300));
    await page.waitForFunction(() => window.__mlDone > 0, null, { timeout:5 * 6e4, polling:1000 }).catch(() => console.warn("collector: Forecast Lab didn't report back; continuing"));

    // open-channel signals: read new Discord chat with Claude, then hand the events to the page for the briefings
    try {
      const names = await page.evaluate(() => nations.map(n => n.name));
      const sig = await signals.run(names);
      await pushSignals(page, sig);
    } catch (e) { console.warn("collector: signals step failed:", e.message); }

    // the Ministry of Finance: this hour's banks, with the latest player and property scans
    await pushFinance(page).catch(e => console.warn("collector: finance step failed:", e.message));
    await pushKeyed(page).catch(e => console.warn("collector: leaderboards step failed:", e.message));
    await pushHistory(page).catch(e => console.warn("collector: history step failed:", e.message));
    await pushPeople(page).catch(e => console.warn("collector: population and combat step failed:", e.message));

    await exportArchive(page);

    // the reports: the daily summary (two releases), the leading threats, and our allies' support assessments.
    // The page lists them first, then writes them one at a time, so each report and its PDF can be let go before the next
    const docs = await page.evaluate(() => {
      const home = findNation($("myNation").value);
      // the same set the Briefing Room shows as "Today's briefing"
      const { threats, allies } = todaysBriefs(home);
      window.__docs = [
        ["intsum", "Daily Intelligence Summary", "", () => intsum(false)],
        ["intsum-allies", "Daily Intelligence Summary (releasable)", "", () => intsum(true)],
        ...threats.map(n => ["assessment-" + n.name, "Intelligence Assessment", n.name, () => nationAssessment(n, home, false)]),
        ...allies.map(n => ["support-" + n.name, "Support Assessment", n.name, () => supportAssessment(n, true)]),
      ];
      return { home:home?.name || null, towns:towns.length, nations:nations.length, scans:ARCHIVE.scans,
        events24h:ARCHIVE.events.filter(e => e.at > Date.now() - 864e5).length, count:window.__docs.length };
    });

    const at = new Date(), run = stamp(at), dir = path.join(RUNS, run);
    fs.mkdirSync(dir, { recursive:true });
    const reports = [];
    try {
      for (let i = 0; i < docs.count; i++) {
        const d = await page.evaluate(i => {
          const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
          const [key, kind, subject, make] = window.__docs[i], d = make();
          return { key, kind, subject, title:d.docTitle, id:d.id, classification:d.classification,
            lead:(d.sections.find(s => s.type === "p")?.text || "").slice(0, 900), text:docText(d), pdf:b64(briefingPdf(d)) };
        }, i);
        const base = slug(d.key);
        fs.writeFileSync(path.join(dir, base + ".pdf"), Buffer.from(d.pdf, "base64"));
        fs.writeFileSync(path.join(dir, base + ".txt"), d.text);
        reports.push({ pdf:base + ".pdf", txt:base + ".txt", kind:d.kind, subject:d.subject, title:d.title, id:d.id, classification:d.classification, lead:d.lead });
      }
    } finally { await page.evaluate(() => { delete window.__docs; }).catch(() => {}); }
    const manifest = { run, at:at.getTime(), home:docs.home, towns:docs.towns, nations:docs.nations, scans:docs.scans, events24h:docs.events24h, seconds:Math.round((Date.now() - t0) / 1000), reports };
    writeJSON(path.join(dir, "manifest.json"), manifest);
    prune();

    Object.assign(S, { lastOk:Date.now(), lastError:null, fails:0, archiveVersion:String(Date.now()), scans:docs.scans });
    S.history.push({ at:t0, ok:true, seconds:manifest.seconds, towns:docs.towns, ...(peak ? { peakMB:peak } : {}) }); S.history = S.history.slice(-200);
    console.log(`collector: scan ${run} done in ${manifest.seconds}s · ${docs.towns} towns · ${reports.length} reports${peak ? ` · ${peak} MB at most` : ""}${logs.length ? " · " + logs.join("; ") : ""}`);
  } catch (e) {
    // say why, when it is known: Playwright only reports that the page went away
    const m = memory(), why = [];
    if (B.lost?.at >= t0) why.push(`the browser ${B.lost.why}`);
    if (m && m.oomKills > oom0) why.push(`the server ran out of memory${m.limitMB ? ` (it is allowed ${m.limitMB} MB)` : ""} and the browser was stopped`);
    S.lastError = (String(e?.message || e).slice(0, 400) + (why.length ? ". Cause: " + why.join("; ") : "")).slice(0, 500);
    S.fails = (S.fails || 0) + 1;
    S.history.push({ at:t0, ok:false, error:S.lastError, ...(peak ? { peakMB:peak } : {}) }); S.history = S.history.slice(-200);
    console.error("collector: run failed:", e, why.length ? "· " + why.join("; ") : "");
    // start the next attempt from a fresh browser, and have one tracking positions again meanwhile
    await closeBrowser(); setTimeout(() => browser().catch(() => {}), 30e3);
  } finally {
    clearInterval(sample); S.running = false; save();
  }
}

// keep every hourly run for seven days, then one a day (the first after midnight UTC)
function prune() {
  let runs; try { runs = fs.readdirSync(RUNS).filter(d => /^\d{8}T\d{4}Z$/.test(d)).sort(); } catch { return; }
  const cutoff = stamp(new Date(Date.now() - 7 * 864e5)), keptDay = new Set();
  for (const r of runs) {
    if (r >= cutoff) continue;
    const day = r.slice(0, 8);
    if (!keptDay.has(day)) { keptDay.add(day); continue; }
    fs.rmSync(path.join(RUNS, r), { recursive:true, force:true });
  }
}

module.exports = { start, status, tokenOk, runSoon, runOnce, refresh, closeBrowser, stop:keyed.stop };

// `node collector.js` runs one scan against a server already listening on PORT
if (require.main === module) { opts.port = +process.env.PORT || 8080; runOnce().then(async () => { await closeBrowser(); process.exit(S.lastError ? 1 : 0); }); }
