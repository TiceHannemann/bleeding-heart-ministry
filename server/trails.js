// Movement history: where every player on the live map has been, kept on disk and read back one player at a time.
// The server already relays the live map's player feed (server.js, /api/players), and every reading of it passes
// through here; when no page is asking for the feed, this module reads it itself, so recording never stops with the
// browser. A position is kept when a player has moved a fair distance, after a jump (a teleport or a warp), and every
// ten minutes while they stand still, so a path stays readable without storing every fifteen-second step. Nothing is
// held in memory but each player's last position and the points not yet written.
//
// On disk: DATA/trails/<YYYY-MM>/<player>.txt, one line per kept position, "seconds,x,z" (overworld blocks).
// Months that have ended are compressed (<player>.txt.gz); months older than TRAILS_KEEP_DAYS (a year) are deleted.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DATA } = require("./paths");

const DIR = path.join(DATA, "trails");
const KEEP_DAYS = Math.max(31, +process.env.TRAILS_KEEP_DAYS || 365);
const MOVE = 64, MIN_GAP = 30, STILL_GAP = 600, JUMP = 500; // blocks and seconds
const MAX_POINTS = 20000; // the most points one answer carries; longer histories are thinned evenly
const last = new Map(); // name -> { t, x, z, kt, kx, kz }: where the player was last seen, and the position last kept
const pending = new Map(); // "YYYY-MM/file" -> lines not yet written
let lastFeedAt = 0, kept = 0, keptDay = "", flushing = null;
const stats = { players:0, pointsToday:0, diskMB:null, months:0, at:null };

const monthOf = t => new Date(t * 1000).toISOString().slice(0, 7);
// a player's name as a file name: Java names are letters, digits and underscores; anything else (a Bedrock prefix) is spelled out
const fileOf = name => String(name).replace(/[^A-Za-z0-9_]/g, c => "~" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const nameOf = f => f.replace(/~([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const validName = n => typeof n === "string" && n.length >= 1 && n.length <= 32 && !/[\/\\\0]/.test(n);

function keep(name, s, t, x, z) {
  const k = monthOf(t) + "/" + fileOf(name);
  (pending.get(k) || pending.set(k, []).get(k)).push(`${t},${x},${z}`);
  Object.assign(s, { kt:t, kx:x, kz:z });
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  if (day !== keptDay) { keptDay = day; kept = 0; }
  kept++;
}

// one reading of the live map's feed: the parsed JSON, or its text
function record(feed, at = Date.now()) {
  let j = feed;
  if (typeof j === "string") { try { j = JSON.parse(j); } catch { return; } }
  const list = (Array.isArray(j) ? j : j?.players) || [], t = Math.round(at / 1000), seen = new Set();
  lastFeedAt = at;
  for (const p of list) {
    if (!validName(p?.name) || p.x == null || p.z == null || (p.world && !/overworld|^world$/i.test(p.world))) continue;
    const x = Math.round(+p.x), z = Math.round(+p.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    seen.add(p.name);
    let s = last.get(p.name);
    if (!s) { s = { t, x, z }; last.set(p.name, s); keep(p.name, s, t, x, z); continue; }
    const d = Math.hypot(x - s.kx, z - s.kz), dt = t - s.kt;
    if (d >= JUMP) {
      // a jump: where they were just before it ends one stretch of the path, where they landed starts the next
      if (s.t > s.kt && Math.hypot(s.x - s.kx, s.z - s.kz) >= 16) keep(p.name, s, s.t, s.x, s.z);
      keep(p.name, s, t, x, z);
    } else if ((d >= MOVE && dt >= MIN_GAP) || dt >= STILL_GAP) keep(p.name, s, t, x, z);
    Object.assign(s, { t, x, z });
  }
  // off the map (logged out or hidden): where they were last seen ends the path; forgotten after a minute away
  for (const [name, s] of last) if (!seen.has(name)) {
    if (s.t > s.kt && Math.hypot(s.x - s.kx, s.z - s.kz) >= 16) keep(name, s, s.t, s.x, s.z);
    if (t - s.t > 60) last.delete(name);
  }
  stats.players = seen.size;
}

// points are written once a minute, a few lines to each file
async function flush() {
  if (flushing || !pending.size) return flushing;
  const batch = [...pending]; pending.clear();
  flushing = (async () => {
    for (const [k, lines] of batch) {
      const [m] = k.split("/");
      try { await fs.promises.mkdir(path.join(DIR, m), { recursive:true }); await fs.promises.appendFile(path.join(DIR, k + ".txt"), lines.join("\n") + "\n"); }
      catch (e) { console.warn("trails: couldn't write", k, e.message); }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

// at shutdown, whatever is waiting is written straight away
function flushSync() {
  for (const [k, lines] of pending) { try { fs.mkdirSync(path.join(DIR, k.split("/")[0]), { recursive:true }); fs.appendFileSync(path.join(DIR, k + ".txt"), lines.join("\n") + "\n"); } catch {} }
  pending.clear();
}

const readLines = (dir, f) => {
  try { return fs.readFileSync(path.join(dir, f + ".txt"), "utf8"); } catch {}
  try { return zlib.gunzipSync(fs.readFileSync(path.join(dir, f + ".txt.gz"))).toString(); } catch {}
  return "";
};
function monthsBetween(from, to) {
  const out = [], d = new Date(Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), 1));
  while (d.getTime() <= to && out.length < 40) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}
// one player's kept positions between two moments, oldest first, as [ms, x, z]
function history(name, from, to = Date.now()) {
  if (!validName(name)) return { name, from, to, total:0, thinned:1, points:[] };
  const f = fileOf(name), lo = Math.floor(from / 1000), hi = Math.ceil(to / 1000), pts = [];
  const take = txt => { for (const line of txt.split("\n")) { const a = line.split(","); if (a.length !== 3) continue; const t = +a[0]; if (t >= lo && t <= hi) pts.push([t * 1000, +a[1], +a[2]]); } };
  for (const m of monthsBetween(from, to)) { take(readLines(path.join(DIR, m), f)); take((pending.get(m + "/" + f) || []).join("\n")); }
  pts.sort((a, b) => a[0] - b[0]);
  const k = Math.ceil(pts.length / MAX_POINTS);
  return { name, from, to, total:pts.length, thinned:k, points:k > 1 ? pts.filter((p, i) => i % k === 0 || i === pts.length - 1) : pts };
}
// players with a history in the last two months whose names start with what was typed
let namesCache = { at:0, list:[] };
function names(q = "", limit = 20) {
  if (Date.now() - namesCache.at > 10 * 6e4) {
    const set = new Set();
    for (const m of monthsBetween(Date.now() - 40 * 864e5, Date.now())) { try { for (const f of fs.readdirSync(path.join(DIR, m))) set.add(nameOf(f.replace(/\.txt(\.gz)?$/, ""))); } catch {} }
    for (const n of last.keys()) set.add(n);
    namesCache = { at:Date.now(), list:[...set].sort((a, b) => a.localeCompare(b)) };
  }
  const low = String(q).toLowerCase();
  return namesCache.list.filter(n => n.toLowerCase().startsWith(low)).slice(0, limit);
}

// once a day: compress the months that have ended, delete those past keeping, and measure what is on disk
function housekeep() {
  let months; try { months = fs.readdirSync(DIR).filter(m => /^\d{4}-\d{2}$/.test(m)).sort(); } catch { return; }
  const now = Date.now(), cur = monthOf(now / 1000), cutoff = monthOf((now - KEEP_DAYS * 864e5) / 1000);
  let bytes = 0;
  for (const m of months) {
    const dir = path.join(DIR, m);
    if (m < cutoff) { fs.rmSync(dir, { recursive:true, force:true }); continue; }
    // an ended month is compressed an hour into the next, once its last points are written
    const ended = m < cur && now - Date.parse(cur + "-01T00:00:00Z") > 36e5;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try {
        if (ended && f.endsWith(".txt")) { const gz = zlib.gzipSync(fs.readFileSync(p), { level:9 }); fs.writeFileSync(p + ".gz", gz); fs.rmSync(p); bytes += gz.length; }
        else bytes += fs.statSync(p).size;
      } catch (e) { console.warn("trails: housekeeping", f, e.message); }
    }
  }
  Object.assign(stats, { diskMB:Math.round(bytes / 1048576 * 10) / 10, months:months.filter(m => m >= cutoff).length, at:now });
}

// fetchFeed: the relay's own (cached) reading of the feed, used only when no page has asked for it lately
function start(fetchFeed) {
  if (process.env.TRAILS === "off") return;
  fs.mkdirSync(DIR, { recursive:true });
  setInterval(() => flush().catch(() => {}), 60e3).unref();
  setInterval(() => { if (Date.now() - lastFeedAt > 20e3) fetchFeed().catch(() => {}); }, 15e3).unref();
  setTimeout(housekeep, 30e3).unref(); setInterval(housekeep, 6 * 36e5).unref();
}
const status = () => ({ ...stats, pointsToday:keptDay === new Date().toISOString().slice(0, 10) ? kept : 0, keepDays:KEEP_DAYS });

module.exports = { start, record, flush, flushSync, history, names, housekeep, status, DIR, _fileOf:fileOf, _nameOf:nameOf };
