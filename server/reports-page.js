// The hourly reports page: the latest briefing up front, then every earlier run.
// Same house style as the briefings: prose first, no dashboards of boxes.
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const when = t => new Date(t).toUTCString().replace(":00 GMT", " UTC").replace(" GMT", " UTC");
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"} ago`; };

module.exports = (runs, st, { open = false } = {}) => {
  const [latest, ...older] = runs;
  const doc = r => `<a href="/reports/${r.run}/${esc(r.pdf)}">${esc(r.title || r.kind)}${r.subject ? ` — ${esc(r.subject)}` : ""}</a> <span class="cl ${/KINGDOM EYES/.test(r.classification) ? "s" : "c"}">${/KINGDOM EYES/.test(r.classification) ? "Kingdom eyes only" : "Releasable"}</span> <a class="t" href="/reports/${r.run}/${esc(r.txt)}">text</a>`;
  const state = st.running ? "A scan is running now." : st.nextRun ? `The next scan is due at ${new Date(st.nextRun).toISOString().slice(11, 16)} UTC.` : "";
  const err = st.lastError ? `<p class="err">The most recent attempt failed: ${esc(st.lastError)}. The reports below are from the last successful scan.</p>` : "";
  const intsum = latest?.reports.find(r => r.kind === "Daily Intelligence Summary");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hourly Intelligence Reports</title><link rel="icon" href="/assets/logo/logo-64.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0b;--fg:#ececec;--mut:#8b8b92;--dim:#55555c;--line:#222226;--intel:#7fe9ff;--hq:#e8406f}
:root[data-theme="light"]{--bg:#fff;--fg:#111;--mut:#555;--dim:#888;--line:#e3e3e3;--intel:#0b7f99;--hq:#b3123d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 "Inter Tight",system-ui,sans-serif}
.w{max-width:860px;margin:0 auto;padding:28px 16px 80px}
header{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:28px;flex-wrap:wrap}
header img{width:36px;height:36px}header b{font:600 15px "Helvetica Neue",Helvetica,Arial,sans-serif}header small{display:block;color:var(--mut);font-size:12px}
header nav{margin-left:auto;display:flex;gap:16px;font-size:14px}a{color:var(--fg)}header a{color:var(--mut);text-decoration:none}header a:hover{color:var(--fg)}
h1{font-weight:500;font-size:clamp(26px,5vw,38px);letter-spacing:-.02em;margin:0 0 6px}
.meta{color:var(--mut);font:13px "JetBrains Mono",ui-monospace,monospace;margin:0 0 26px}
.lead{font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.7;border-left:2px solid var(--intel);padding-left:18px;margin:0 0 28px}
h2{font-weight:500;font-size:17px;margin:40px 0 12px;color:var(--mut)}
ol{padding-left:20px;margin:0}li{margin:6px 0}
.cl{font:11px "JetBrains Mono",monospace;margin-left:6px}.cl.s{color:var(--hq)}.cl.c{color:var(--intel)}.t{color:var(--dim);font-size:13px;margin-left:6px}
details{border-top:1px solid var(--line);padding:10px 0}summary{cursor:pointer;color:var(--mut);font:13px "JetBrains Mono",monospace}summary b{color:var(--fg);font-weight:400}
details ol{margin-top:10px}.err{color:var(--hq)}
.imp{border-top:1px solid var(--line);margin-top:44px;padding-top:18px;color:var(--mut);font-size:14px}
.imp button,.scan{font:inherit;font-size:13px;background:transparent;color:var(--fg);border:1px solid var(--line);padding:6px 12px;cursor:pointer;border-radius:2px}
.imp button:hover,.scan:hover{border-color:var(--mut)}
</style></head><body><div class="w">
<header><img src="/assets/logo/logo-128.png" alt=""><div><b>Kingdom of The Bleeding Heart</b><small>Ministry of Intelligence — Hourly Reports</small></div>
<nav><a href="/gov#dossier">Ministries</a><a href="/gov#briefings">Briefing Room</a>${open ? "" : `<form method="post" action="/logout" style="margin:0"><a href="#" onclick="this.parentNode.submit();return false">Sign out</a></form>`}</nav></header>
<h1>Hourly intelligence</h1>
<p class="meta">${latest ? `Last scan ${when(latest.at)} (${ago(latest.at)}) · ${latest.towns.toLocaleString()} towns · ${latest.nations.toLocaleString()} nations · ${latest.scans.toLocaleString()} scans archived · ${latest.events24h.toLocaleString()} events in 24 h` : "No scan has finished yet."} · ${esc(state)} <button class="scan" onclick="fetch('/api/scan-now',{method:'POST'}).then(r=>r.json()).then(j=>{if(j.error)alert(j.error);location.reload()})">Scan now</button></p>
${err}
${latest ? `${intsum?.lead ? `<p class="lead">${esc(intsum.lead)}</p>` : ""}
<h2>Latest reports</h2><ol>${latest.reports.map(r => `<li>${doc({ ...r, run:latest.run })}</li>`).join("")}</ol>` : `<p>The server scans EarthMC every hour. The first scan takes a few minutes; this page fills in when it finishes.</p>`}
${older.length ? `<h2>Earlier runs</h2>${older.map(o => `<details><summary><b>${when(o.at)}</b> · ${o.towns.toLocaleString()} towns · ${o.events24h} events in 24 h</summary><ol>${o.reports.map(r => `<li>${doc({ ...r, run:o.run })}</li>`).join("")}</ol></details>`).join("")}` : ""}
${open ? "" : `<div class="imp"><p>To add collection from a browser's Watch mode, export its archive in the Briefing Room and send it here. It is merged at the next scan.</p>
<input type="file" id="f" accept="application/json,.json" hidden><button onclick="document.getElementById('f').click()">Send an archive to the server</button> <span id="m"></span></div>`}
</div><script>
if (document.getElementById("f")) document.getElementById("f").onchange = async e => { const f = e.target.files[0]; if (!f) return; const m = document.getElementById("m"); m.textContent = "Uploading…";
  try { const r = await fetch("/api/import", { method:"POST", body:await f.text(), headers:{ "Content-Type":"application/json" } }); const j = await r.json(); m.textContent = j.message || j.error; } catch (err) { m.textContent = "Upload failed: " + err.message; } };
</script></body></html>`;
};
