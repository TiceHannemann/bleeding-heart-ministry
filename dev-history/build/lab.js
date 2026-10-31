/* ---------- Forecast Lab page ---------- */
const pct = (v, d = 0) => v == null ? "—" : (v * 100).toFixed(d) + "%";
function learnedNotes(key, m) {
  const M = ML_MODELS[key];
  return M.names.map((name, i) => ({ name, w:m.w[i], w0:M.prior[i], d:m.w[i] - M.prior[i] })).filter((f, i) => i > 0 && Math.abs(f.d) > 0.15)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3)
    .map(f => `${f.name} ${Math.sign(f.w) !== Math.sign(f.w0) && Math.abs(f.w0) > .1 ? "now points the other way" : Math.abs(f.w) > Math.abs(f.w0) ? "matters more than the rules assumed" : "matters less than the rules assumed"}`);
}
function curveSvg(m) {
  const days = Object.keys(m.daily).sort(); if (days.length < 2) return `<div class="lab-mini empty">Learning curve appears after two days of checked forecasts.</div>`;
  const pts = days.map(d => { const [n, a, b] = m.daily[d]; return [a / n, b / n]; }), max = Math.max(0.05, ...pts.flat());
  const X = i => 6 + i / (pts.length - 1) * 228, Y = v => 66 - v / max * 60;
  return `<svg class="lab-mini" viewBox="0 0 240 72"><line x1="6" y1="66" x2="234" y2="66" stroke="var(--line2)"/>
    <polyline fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-dasharray="3 3" points="${pts.map((p, i) => `${X(i)},${Y(p[1])}`).join(" ")}"/>
    <polyline fill="none" stroke="var(--intel)" stroke-width="2" points="${pts.map((p, i) => `${X(i)},${Y(p[0])}`).join(" ")}"/></svg>
    <div class="lab-leg"><span style="--c:var(--intel)">Model error</span><span style="--c:var(--dim)">Starting rules</span></div>`;
}
function calibSvg(m) {
  if (m.n < 10) return "";
  const bars = m.calib.map(([n, k], i) => n ? `<rect x="${6 + i * 23}" y="${66 - k / n * 60}" width="18" height="${k / n * 60}" fill="var(--intel)" opacity="${Math.min(1, .25 + n / 30)}"><title>Forecast ${i * 10}–${i * 10 + 10}%: happened ${k} of ${n} times</title></rect>` : "").join("");
  return `<svg class="lab-mini" viewBox="0 0 240 72"><line x1="6" y1="66" x2="234" y2="6" stroke="var(--dim)" stroke-dasharray="3 3"/>${bars}<line x1="6" y1="66" x2="234" y2="66" stroke="var(--line2)"/></svg>
    <div class="lab-leg"><span style="--c:var(--intel)">How often it happened, per forecast band</span><span style="--c:var(--dim)">Perfect calibration</span></div>`;
}
async function renderForecastLab() {
  const sum = $("labSum"); if (!sum) return;
  if (!ML.loaded) { sum.innerHTML = `<p class="br-empty">The Forecast Lab needs this browser's storage; it isn't available here.</p>`; return; }
  const st = mlState(), ms = Object.entries(st.models), n = ms.reduce((s, [, m]) => s + m.n, 0);
  const sse = ms.reduce((s, [, m]) => s + m.sse, 0), sse0 = ms.reduce((s, [, m]) => s + m.sse0, 0), skill = n ? 1 - sse / Math.max(1e-9, sse0) : null;
  sum.innerHTML = `<div class="stat"><div class="n">${st.made.toLocaleString()}</div><div class="l">Forecasts made</div></div>
    <div class="stat"><div class="n">${n.toLocaleString()}</div><div class="l">Checked against what happened</div></div>
    <div class="stat" style="--c:${skill == null ? "var(--dim)" : skill >= 0 ? "var(--green)" : "var(--orange)"}"><div class="n">${skill == null ? "—" : (skill >= 0 ? "+" : "") + Math.round(skill * 100) + "%"}</div><div class="l">Better than the starting rules</div></div>
    <div class="stat"><div class="n">${ML.open.length.toLocaleString()}</div><div class="l">Open forecasts waiting</div></div>`;
  $("labModels").innerHTML = ms.map(([key, m]) => {
    const M = ML_MODELS[key], sk = skillOf(m), notes = learnedNotes(key, m);
    return `<article class="lab-card">
      <h3>${M.label}<small>within ${M.horizon === 3 ? "72 hours" : M.horizon + " days"}</small></h3>
      <div class="lab-stats"><div><b>${m.n.toLocaleString()}</b><span>checked</span></div><div><b>${m.n ? pct(m.pos / m.n) : "—"}</b><span>happened</span></div>
        <div><b>${m.n ? pct(m.hits / m.n) : "—"}</b><span>correct</span></div><div><b style="color:${sk == null ? "inherit" : sk >= 0 ? "var(--green)" : "var(--orange)"}">${sk == null ? "—" : (sk >= 0 ? "+" : "") + Math.round(sk * 100) + "%"}</b><span>vs rules</span></div></div>
      ${curveSvg(m)}${calibSvg(m)}
      <div class="lab-learned">${m.n < 5 ? "Still using its starting rules; it learns as forecasts are checked." : notes.length ? "Learned: " + notes.map(esc).join("; ") + "." : "Its weights still match the starting rules closely."}</div>
    </article>`;
  }).join("");
  const now = Date.now(), live = ML.open.filter(p => p.due > now).sort((a, b) => b.p - a.p).slice(0, 25);
  $("labLive").innerHTML = live.length ? `<table class="nt"><tr><th>Forecast</th><th class="num">Chance</th><th class="num">Window closes</th></tr>${live.map(p => `<tr><td>${esc(p.subject)} <span class="lab-ev">${esc(ML_MODELS[p.model].label.toLowerCase())}</span></td>
      <td class="num"><span class="lab-bar"><i style="width:${Math.round(p.p * 100)}%"></i></span>${pct(p.p)}</td><td class="num">${fmtDay(p.due)}</td></tr>`).join("")}</table>`
    : `<p class="br-empty">No open forecasts. The first ones are made at the next scan.</p>`;
  const done = await recentResolved(30);
  $("labDone").innerHTML = done.length ? `<table class="nt"><tr><th>Forecast</th><th class="num">Said</th><th class="num">Rules said</th><th>Outcome</th></tr>${done.map(p => { const right = (p.p >= 0.5) === !!p.y;
      return `<tr><td>${esc(p.subject)} <span class="lab-ev">${esc(ML_MODELS[p.model].label.toLowerCase())}</span></td><td class="num">${pct(p.p)}</td><td class="num" style="color:var(--mut)">${pct(p.p0)}</td>
      <td><span class="lab-out ${right ? "ok" : "miss"}">${p.y ? "Happened" : "Didn't happen"} · ${right ? "right" : "wrong"}</span></td></tr>`; }).join("")}</table>`
    : `<p class="br-empty">Nothing checked yet. Forecasts are checked when their event happens or their window closes (3 to 7 days).</p>`;
}
document.addEventListener("click", async e => {
  if (e.target.id === "labReset") { e.target.hidden = true; $("labResetConfirm").hidden = false; return; }
  if (e.target.id === "labResetNo") { $("labReset").hidden = false; $("labResetConfirm").hidden = true; return; }
  if (e.target.id === "labResetYes") {
    ML.state = null; ML.open = [];
    try { await idbDo(["predictions", "meta"], "readwrite", tx => { tx.objectStore("predictions").clear(); tx.objectStore("meta").delete("ml"); }); } catch {}
    $("labReset").hidden = false; $("labResetConfirm").hidden = true; showToast("Forecast Lab reset to its starting rules."); renderForecastLab();
  }
});
