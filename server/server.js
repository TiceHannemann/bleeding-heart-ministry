// Kingdom of The Bleeding Heart — hosted server
// Serves the public website at /, the ministries at /gov (password checked here, on the server),
// and runs the hourly collector, which scans EarthMC and writes fresh intelligence reports.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DATA, APP, ASSETS, readJSON, writeJSON } = require("./paths");
const collector = require("./collector");

const PORT = +process.env.PORT || 8080;
const EVERY_MIN = Math.max(15, +process.env.SCAN_EVERY_MINUTES || 60);

// The ministry password comes only from MINISTRY_PASSWORD on the host. Without it the whole site is open, with no sign-in.
const OPEN = !process.env.MINISTRY_PASSWORD;
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
if (OPEN) console.log("No MINISTRY_PASSWORD set: the ministries are open to everyone (archive uploads are off).");
const passwordOk = pw => {
  if (OPEN) return false;
  const want = sha("bh-ministry:" + process.env.MINISTRY_PASSWORD);
  const got = sha("bh-ministry:" + String(pw || ""));
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
};

// Sessions: a signed cookie holding its expiry. The secret is kept on the data volume so restarts don't sign everyone out.
const SECRET = process.env.SESSION_SECRET || (() => {
  const f = path.join(DATA, "session-secret");
  try { return fs.readFileSync(f, "utf8"); } catch {}
  const s = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(f, s); return s;
})();
const SESSION_DAYS = 14;
const sign = v => crypto.createHmac("sha256", SECRET).update(v).digest("hex");
const makeSession = () => { const exp = String(Date.now() + SESSION_DAYS * 864e5); return exp + "." + sign(exp); };
const cookieOf = (req, name) => (req.headers.cookie || "").split(/;\s*/).map(c => c.split("=")).find(([k]) => k === name)?.[1];
function signedIn(req) {
  if (OPEN) return true;
  const v = cookieOf(req, "bh_s"); if (!v) return false;
  const [exp, mac] = v.split(".");
  if (!exp || !mac || +exp < Date.now()) return false;
  const want = sign(exp);
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}
const setSession = res => res.setHeader("Set-Cookie", `bh_s=${makeSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${process.env.INSECURE_COOKIE ? "" : "; Secure"}`);
const needLogin = (req, res, next) => signedIn(req) ? next() : req.path.startsWith("/api/") ? res.status(401).json({ error:"sign in first" }) : res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));

// slow down password guessing: five tries per address per ten minutes
const tries = new Map();
const tooMany = ip => { const now = Date.now(), t = (tries.get(ip) || []).filter(x => now - x < 10 * 6e4); tries.set(ip, t); return t.length >= 5; };

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "same-origin"); next(); });

/* ---------- Public website ---------- */
const publicHtml = () => fs.readFileSync(path.join(APP, "kingdom-of-the-bleeding-heart.html"), "utf8")
  .replaceAll('href="earthmc-ruin-scanner.html"', 'href="/gov"');
app.get(["/", "/index.html", "/kingdom-of-the-bleeding-heart.html"], (req, res) => res.type("html").send(publicHtml()));
app.use("/assets", express.static(ASSETS, { maxAge:"7d" }));
app.get("/healthz", (req, res) => res.json({ ok:true, ...collector.status() }));

/* ---------- Sign-in ---------- */
const loginPage = (err, next) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Government Sign-in</title><link rel="icon" href="/assets/logo/logo-64.png"><style>
:root{--ink:#111;--mut:#666;--line:#ddd;--bg:#fff;--red:#b3123d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#eee;--mut:#999;--line:#333;--bg:#0b0b0c}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;padding:16px}
form{width:100%;max-width:360px}.c{display:flex;gap:12px;align-items:center;margin-bottom:28px}.c img{width:48px;height:48px}.c b{font-size:17px;letter-spacing:-.01em}.c small{display:block;color:var(--mut);font-size:12px}
label{display:block;font-size:13px;color:var(--mut);margin-bottom:6px}input{width:100%;padding:11px 12px;font:inherit;border:1px solid var(--line);background:transparent;color:inherit;border-radius:2px}
button{margin-top:14px;width:100%;padding:11px;font:inherit;font-weight:600;background:var(--ink);color:var(--bg);border:0;border-radius:2px;cursor:pointer}
.e{color:var(--red);font-size:13px;min-height:20px;margin-top:10px}a{color:var(--mut);font-size:13px}</style></head><body>
<form method="post" action="/login"><div class="c"><img src="/assets/logo/logo-128.png" alt=""><div><b>Kingdom of The Bleeding Heart</b><small>Government staff sign-in</small></div></div>
<input type="hidden" name="next" value="${String(next || "/gov").replace(/[^\w\/#?=&.-]/g, "")}">
<label for="pw">Ministry password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button>Sign in</button><div class="e">${err || ""}</div><a href="/">← Public website</a></form></body></html>`;
app.get("/login", (req, res) => signedIn(req) ? res.redirect("/gov") : res.type("html").send(loginPage("", req.query.next)));
app.post("/login", express.urlencoded({ extended:false, limit:"4kb" }), (req, res) => {
  if (OPEN) return res.redirect("/gov");
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).type("html").send(loginPage("Too many attempts. Wait ten minutes and try again.", req.body.next));
  if (!passwordOk(req.body.password)) { tries.get(ip).push(Date.now()); return res.status(401).type("html").send(loginPage("Incorrect password.", req.body.next)); }
  tries.delete(ip); setSession(res);
  const next = String(req.body.next || "/gov");
  res.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/gov");
});
app.post("/logout", (req, res) => { res.setHeader("Set-Cookie", "bh_s=; Path=/; Max-Age=0"); res.redirect("/"); });

/* ---------- Government website ---------- */
// The page is the same standalone file; the server adds a small script that pulls the hourly archive into the browser.
const SYNC = fs.readFileSync(path.join(__dirname, "client-sync.js"), "utf8");
const govHtml = () => fs.readFileSync(path.join(APP, "earthmc-ruin-scanner.html"), "utf8")
  .replace("<head>", `<head>\n<script>window.BH_SERVER = true; try { sessionStorage.setItem("bh_unlocked", '["attack","intel"]'); } catch {}</script>`)
  .replace(/<\/body>(?![\s\S]*<\/body>)/, `<script>\n${SYNC}\n</script>\n</body>`)
  .replaceAll('href="kingdom-of-the-bleeding-heart.html"', 'href="/"');
// the collector signs itself in with a one-time token, so it never needs the password
app.get(["/gov", "/earthmc-ruin-scanner.html"], (req, res, next) => {
  if (req.query.ct && collector.tokenOk(req.query.ct)) { setSession(res); return res.type("html").send(govHtml()); }
  next();
}, needLogin, (req, res) => res.type("html").setHeader("Cache-Control", "no-store").send(govHtml()));

/* ---------- Intelligence API (signed-in only) ---------- */
app.get("/api/status", needLogin, (req, res) => res.json({ ...collector.status(), open:OPEN }));
// the browser checks this first, and only downloads the archive when it has changed
app.get("/api/archive/version", needLogin, (req, res) => res.json({ version:collector.status().archiveVersion || null }));
app.get("/api/archive", needLogin, (req, res) => {
  const gz = path.join(DATA, "archive.json.gz");
  if (!fs.existsSync(gz)) return res.status(404).json({ error:"No scan yet. The first hourly scan is running or about to start." });
  res.setHeader("Cache-Control", "no-store");
  if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) { res.setHeader("Content-Encoding", "gzip"); res.type("json"); return fs.createReadStream(gz).pipe(res); }
  res.type("json"); fs.createReadStream(gz).pipe(zlib.createGunzip()).pipe(res);
});
// earlier collection from Watch mode in a browser: upload the exported archive and it is merged at the next scan
app.post("/api/import", needLogin, express.text({ type:"*/*", limit:"200mb" }), (req, res) => {
  // with no password anyone could send one, so uploads need a password to be set
  if (OPEN) return res.status(403).json({ error:"Archive uploads are off while the site has no password. Set MINISTRY_PASSWORD to turn them on." });
  let j; try { j = JSON.parse(req.body); } catch { return res.status(400).json({ error:"That isn't JSON." }); }
  if (j?.kind !== "bleeding-heart-archive") return res.status(400).json({ error:"That file isn't an intelligence archive." });
  fs.mkdirSync(path.join(DATA, "imports"), { recursive:true });
  fs.writeFileSync(path.join(DATA, "imports", `${Date.now()}.json`), req.body);
  res.json({ ok:true, message:"Archive received. It will be merged into the server's archive at the next scan." });
});
// at most one extra scan per ten minutes, however many people press the button
app.post("/api/scan-now", needLogin, (req, res) => {
  const st = collector.status();
  if (st.running || (st.lastRun && Date.now() - st.lastRun < 10 * 6e4)) return res.status(429).json({ error:"A scan ran in the last ten minutes. Try again later.", ...st });
  collector.runSoon(); res.json({ ok:true, ...collector.status() });
});

/* ---------- Hourly reports ---------- */
const RUNS = path.join(DATA, "runs");
const runList = () => { try { return fs.readdirSync(RUNS).filter(d => /^\d{8}T\d{4}Z$/.test(d)).sort().reverse(); } catch { return []; } };
app.get("/api/reports", needLogin, (req, res) => res.json(runList().slice(0, +req.query.limit || 48).map(r => readJSON(path.join(RUNS, r, "manifest.json"))).filter(Boolean)));
app.get("/reports/:run/:file", needLogin, (req, res) => {
  const { run, file } = req.params;
  if (!/^(\d{8}T\d{4}Z|latest)$/.test(run) || !/^[\w.-]+\.(pdf|txt)$/.test(file)) return res.status(404).end();
  const dir = run === "latest" ? runList()[0] : run;
  if (!dir) return res.status(404).send("No reports yet.");
  const f = path.join(RUNS, dir, file);
  if (!fs.existsSync(f)) return res.status(404).send("Not found.");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(f);
});
app.get("/gov/reports", needLogin, (req, res) => res.type("html").send(require("./reports-page")(runList().slice(0, 72).map(r => readJSON(path.join(RUNS, r, "manifest.json"))).filter(Boolean), collector.status(), { open:OPEN })));

app.use((req, res) => res.status(404).type("text").send("Not found."));

app.listen(PORT, () => {
  console.log(`Bleeding Heart server on :${PORT} · data in ${DATA} · scanning every ${EVERY_MIN} min`);
  collector.start({ port:PORT, everyMin:EVERY_MIN });
});
