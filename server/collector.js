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

const RUNS = path.join(DATA, "runs"), IMPORTS = path.join(DATA, "imports"), PROFILE = path.join(DATA, "profile");
const STATUS_FILE = path.join(DATA, "status.json");
const SCAN_TIMEOUT = 25 * 6e4;

const S = Object.assign({ running:false, lastRun:null, lastOk:null, lastError:null, nextRun:null, archiveVersion:null, scans:0, history:[] }, readJSON(STATUS_FILE) || {}, { running:false });
const save = () => { try { writeJSON(STATUS_FILE, S); } catch (e) { console.warn("status not saved:", e.message); } };
const tokens = new Map();
let opts = { port:8080, everyMin:60 }, timer = 0;

function tokenOk(t) {
  const exp = tokens.get(t);
  if (!exp) return false;
  tokens.delete(t); // one use only
  return exp > Date.now();
}
function status() { const { history, ...s } = S; return { ...s, recent:history.slice(-24), signals:signals.status(), finance:finance.status() }; }

function schedule() {
  clearTimeout(timer);
  // line up with the clock: a few minutes past each interval, so reports land at predictable times
  const every = opts.everyMin * 6e4, now = Date.now();
  let due = Math.ceil((now - 3 * 6e4) / every) * every + 3 * 6e4;
  // if the last good scan is older than an interval (first boot, or after downtime), scan straight away
  if (!S.lastOk || now - S.lastOk > every) due = now + 15e3;
  S.nextRun = due; save();
  timer = setTimeout(async () => { await runOnce(); schedule(); }, due - now);
}
function start(o) {
  opts = { ...opts, ...o }; schedule();
  // the finance deep scan (every player and quarter) runs between hourly scans; when it finishes, visitors get it straight away
  finance.start({ busy:() => S.running, after:async () => {
    if (S.running) return;
    S.running = true;
    try { const page = await browser(); await pushFinance(page); await exportArchive(page); }
    catch (e) { console.warn("collector: finance refresh failed:", e.message); }
    finally { S.running = false; save(); }
  } });
  // open the browser straight away so live positions are recorded from the start, not only after the first scan
  setTimeout(() => { if (!S.running) browser().catch(e => console.error("collector: browser failed to open:", e.message)); }, 2000);
  // check every few minutes that tracking is still running (the browser reopens itself after a crash or its daily restart)
  setInterval(() => { if (!S.running && !B.opening) browser().then(p => p.evaluate(() => ({ polls:MOVES.polls, lastOk:MOVES.lastOk, err:MOVES.err, visits:MOVES.visits.length })))
    .then(m => { S.moves = m; }).catch(() => {}); }, 5 * 6e4).unref();
}
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
    const ctx = await chromium.launchPersistentContext(PROFILE, { headless:true, viewport:{ width:1280, height:900 }, args:["--disable-dev-shm-usage"],
      ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) }); // e.g. "msedge" to use an installed browser locally
    // map tiles, skins and web fonts aren't needed to scan or to write PDFs
    await ctx.route(/map\.earthmc\.net\/tiles\/.*\.png|mc-heads\.net|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    if (global.__collectorRoutes) await global.__collectorRoutes(ctx); // tests install a fake EarthMC API here
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on("pageerror", e => { B.logs.push("page error: " + e.message); B.logs = B.logs.slice(-20); });
    // a crashed or closed browser is reopened in half a minute, so position tracking resumes by itself
    const lost = () => { if (B.page !== page) return; console.warn("collector: browser lost; reopening"); Object.assign(B, { ctx:null, page:null }); setTimeout(() => browser().catch(e => console.error("collector: reopen failed:", e.message)), 30e3); };
    page.on("crash", lost); ctx.on("close", lost);
    await page.addInitScript(() => {
      window.BH_COLLECTOR = true;
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

// the archive, for visitors' browsers: everything the page keeps, including the last scan and the Forecast Lab
async function exportArchive(page) {
  const archive = await page.evaluate(() => idbDo(["meta", "series", "frames", "events", "visits", "predictions"], "readonly", async tx => {
    const m = tx.objectStore("meta");
    return JSON.stringify({ kind:"bleeding-heart-archive", v:1, server:true, exported:Date.now(),
      stats:await reqP(m.get("stats")), frame:await reqP(m.get("frame")), lastScan:await reqP(m.get("lastScan")), ml:await reqP(m.get("ml")),
      signals:await reqP(m.get("signals")), finance:await reqP(m.get("finance")),
      series:await reqP(tx.objectStore("series").getAll()),
      frameKeys:await reqP(tx.objectStore("frames").getAllKeys()), frames:await reqP(tx.objectStore("frames").getAll()),
      events:await reqP(tx.objectStore("events").getAll()), visits:await reqP(tx.objectStore("visits").getAll()),
      predictions:await reqP(tx.objectStore("predictions").getAll()) });
  }));
  const gz = path.join(DATA, "archive.json.gz");
  fs.writeFileSync(gz + ".tmp", zlib.gzipSync(archive, { level:6 })); fs.renameSync(gz + ".tmp", gz);
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

async function runOnce() {
  if (S.running) return;
  S.running = true; S.lastRun = Date.now(); save();
  const t0 = Date.now();
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
      await page.evaluate(ev => { SIGNALS = ev; return idbDo(["meta"], "readwrite", tx => tx.objectStore("meta").put(ev, "signals")); }, sig);
    } catch (e) { console.warn("collector: signals step failed:", e.message); }

    // the Ministry of Finance: this hour's banks, with the latest player and property scans
    await pushFinance(page).catch(e => console.warn("collector: finance step failed:", e.message));

    await exportArchive(page);

    // the reports: the daily summary (two releases), the leading threats, and our allies' support assessments
    const docs = await page.evaluate(() => {
      const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
      const home = findNation($("myNation").value);
      const live = n => n.towns.some(t => !t.ruined);
      const threats = nations.filter(n => n !== home && live(n) && !["home", "ally"].includes(assess(n, home?.name)?.stance))
        .sort((a, b) => (assess(b, home?.name)?.hostility || 0) * (assess(b).strength + 50) - (assess(a, home?.name)?.hostility || 0) * (assess(a).strength + 50) || b.active30 - a.active30).slice(0, 5);
      const allies = home ? nations.filter(n => n !== home && live(n) && assess(n, home.name)?.stance === "ally").sort((a, b) => assess(b).risk - assess(a).risk).slice(0, 3) : [];
      const list = [
        ["intsum", "Daily Intelligence Summary", "", intsum(false)],
        ["intsum-allies", "Daily Intelligence Summary (releasable)", "", intsum(true)],
        ...threats.map(n => ["assessment-" + n.name, "Intelligence Assessment", n.name, nationAssessment(n, home, false)]),
        ...allies.map(n => ["support-" + n.name, "Support Assessment", n.name, supportAssessment(n, true)]),
      ];
      return { home:home?.name || null, towns:towns.length, nations:nations.length, scans:ARCHIVE.scans,
        events24h:ARCHIVE.events.filter(e => e.at > Date.now() - 864e5).length,
        docs:list.map(([key, kind, subject, d]) => ({ key, kind, subject, title:d.docTitle, id:d.id, classification:d.classification,
          lead:(d.sections.find(s => s.type === "p")?.text || "").slice(0, 900), text:docText(d), pdf:b64(briefingPdf(d)) })) };
    });

    const at = new Date(), run = stamp(at), dir = path.join(RUNS, run);
    fs.mkdirSync(dir, { recursive:true });
    const reports = docs.docs.map(d => {
      const base = slug(d.key);
      fs.writeFileSync(path.join(dir, base + ".pdf"), Buffer.from(d.pdf, "base64"));
      fs.writeFileSync(path.join(dir, base + ".txt"), d.text);
      return { pdf:base + ".pdf", txt:base + ".txt", kind:d.kind, subject:d.subject, title:d.title, id:d.id, classification:d.classification, lead:d.lead };
    });
    const manifest = { run, at:at.getTime(), home:docs.home, towns:docs.towns, nations:docs.nations, scans:docs.scans, events24h:docs.events24h, seconds:Math.round((Date.now() - t0) / 1000), reports };
    writeJSON(path.join(dir, "manifest.json"), manifest);
    prune();

    Object.assign(S, { lastOk:Date.now(), lastError:null, archiveVersion:String(Date.now()), scans:docs.scans });
    S.history.push({ at:t0, ok:true, seconds:manifest.seconds, towns:docs.towns }); S.history = S.history.slice(-200);
    console.log(`collector: scan ${run} done in ${manifest.seconds}s · ${docs.towns} towns · ${reports.length} reports${logs.length ? " · " + logs.join("; ") : ""}`);
  } catch (e) {
    S.lastError = String(e?.message || e).slice(0, 500);
    S.history.push({ at:t0, ok:false, error:S.lastError }); S.history = S.history.slice(-200);
    console.error("collector: run failed:", e);
    // start the next attempt from a fresh browser, and have one tracking positions again meanwhile
    await closeBrowser(); setTimeout(() => browser().catch(() => {}), 30e3);
  } finally {
    S.running = false; save();
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

module.exports = { start, status, tokenOk, runSoon, runOnce, closeBrowser };

// `node collector.js` runs one scan against a server already listening on PORT
if (require.main === module) { opts.port = +process.env.PORT || 8080; runOnce().then(async () => { await closeBrowser(); process.exit(S.lastError ? 1 : 0); }); }
