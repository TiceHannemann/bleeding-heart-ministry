/* ---------- Intel over time + war room bridge ----------
   Each finished scan saves a compact snapshot of every nation (active members, residents, towns,
   chunks, gold, allies, enemies) in this browser. The dossier draws trend lines from them and
   marks what changed since the previous scan. "Send to war room" copies the scan's best targets and
   the same nation snapshot so it can be pasted into the department's shared War Room. */
const WAR_ROOM = "https://claude.ai/artifact/DrxXKg6uDf1GANPMDZcdWH";
const HISTORY_MAX = 90;
let history = [];
try { history = JSON.parse(localStorage.getItem("rh_history") || "[]"); } catch {}
const nationSnap = () => nations.map(n => ({ n:n.name, a:n.active30, r:n.residents, t:n.towns.length, c:n.chunks, g:Math.round(goldOf(n)), al:n.allies.length, en:n.enemies.length }));
function saveHistory() {
  if (!nations.length) return;
  const snap = { at:Date.now(), nations:nationSnap() };
  // a rescan within 30 minutes replaces the last point instead of adding one
  if (history.length && snap.at - history[history.length - 1].at < 30 * 6e4) history[history.length - 1] = snap; else history.push(snap);
  history = history.slice(-HISTORY_MAX);
  try { localStorage.setItem("rh_history", JSON.stringify(history)); }
  catch { history = history.slice(-30); try { localStorage.setItem("rh_history", JSON.stringify(history)); } catch {} }
}
// the scan before the current one, for "since last scan" arrows
const prevSnap = () => history.length >= 2 ? history[history.length - 2] : null;
function deltaOf(name, key) {
  const p = prevSnap()?.nations.find(x => x.n === name), cur = history[history.length - 1]?.nations.find(x => x.n === name);
  return p && cur ? cur[key] - p[key] : null;
}
const deltaTag = (name, key) => {
  const d = deltaOf(name, key); if (!d) return "";
  return `<span class="delta ${d > 0 ? "up" : "down"}" title="${d > 0 ? "+" : ""}${d} since ${new Date(prevSnap().at).toLocaleDateString()}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
};

// ---- trend chart (SVG) ----
let trendMetric = "a";
const TREND_METRICS = [["a", "Active 30d"], ["r", "Residents"], ["c", "Chunks"], ["g", "Gold"]];
function drawTrends(n, mine) {
  const svg = $("trendChart"); if (!svg) return;
  const series = name => history.map(h => ({ at:h.at, v:h.nations.find(x => x.n === name)?.[trendMetric] })).filter(p => p.v != null);
  const a = series(n.name), b = mine && mine !== n ? series(mine.name) : [];
  const W = 800, H = 260, L = 48, R = 14, T = 14, B = 28, pts = [...a, ...b];
  if (pts.length < 2) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" fill="${COL.mut}" font-size="13" text-anchor="middle" font-family="Inter Tight, sans-serif">Trends appear after two scans. Each scan you run adds a point.</text>`; return; }
  let x0 = Math.min(...pts.map(p => p.at)), x1 = Math.max(...pts.map(p => p.at)); if (x0 === x1) { x0 -= 864e5; x1 += 864e5; }
  const top = (v => { const p = Math.pow(10, Math.floor(Math.log10(v))); return [1, 2, 2.5, 5, 10].map(k => k * p).find(k => k >= v); })(Math.max(1, ...pts.map(p => p.v)));
  const X = t => L + (t - x0) / (x1 - x0) * (W - L - R), Y = v => T + (1 - v / top) * (H - T - B);
  const fmt = v => trendMetric === "g" ? goldShort(v) : v >= 1e4 ? (v / 1e3).toFixed(0) + "k" : Math.round(v).toLocaleString();
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = top * i / 4; g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${L - 8}" y="${Y(v) + 4}" fill="${COL.mut}" font-size="10" text-anchor="end" font-family="JetBrains Mono, monospace">${fmt(v)}</text>`; }
  [x0, x1].forEach((t, i) => g += `<text x="${X(t)}" y="${H - 8}" fill="${COL.mut}" font-size="10" text-anchor="${i ? "end" : "start"}" font-family="JetBrains Mono, monospace">${new Date(t).toLocaleDateString(undefined, { month:"short", day:"numeric" })}</text>`);
  const line = (s, col, area) => {
    if (!s.length) return "";
    const d = s.map((p, i) => `${i ? "L" : "M"}${X(p.at).toFixed(1)},${Y(p.v).toFixed(1)}`).join(""), last = s[s.length - 1];
    return (area ? `<path d="${d}L${X(last.at)},${Y(0)}L${X(s[0].at)},${Y(0)}Z" fill="rgba(255,255,255,.05)"/>` : "") +
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>` +
      s.map(p => `<circle cx="${X(p.at)}" cy="${Y(p.v)}" r="2.5" fill="${col}"><title>${new Date(p.at).toLocaleString()} · ${fmt(p.v)}</title></circle>`).join("") +
      `<circle cx="${X(last.at)}" cy="${Y(last.v)}" r="4.5" fill="${col}"/><text x="${X(last.at) - 8}" y="${Y(last.v) - 9}" fill="${col}" font-size="12" font-weight="600" text-anchor="end" font-family="Inter Tight, sans-serif">${fmt(last.v)}</text>`;
  };
  svg.innerHTML = g + line(b, COL.hq, false) + line(a, COL.fg, true);
}

// ---- alliance web: the nation, its allies and enemies, and theirs (2 hops) ----
let webLayout = null;
function drawWeb(n, mine) {
  const c = $("webCanvas"); if (!c) return;
  const g = c.getContext("2d"), W = c.width, H = c.height;
  const byName = Object.fromEntries(nations.map(x => [x.name, x]));
  if (!nations.some(x => x.allies.length || x.enemies.length)) {
    g.fillStyle = "#070707"; g.fillRect(0, 0, W, H); g.fillStyle = COL.mut; g.font = "15px Inter Tight, sans-serif"; g.textAlign = "center";
    g.fillText("Alliance data isn't available from the API in this scan.", W / 2, H / 2); return;
  }
  if (!webLayout || webLayout.key !== n.name + "|" + nations.length) {
    // pick nodes: the nation, its direct links, then second-hop links, capped at 36 by activity
    const first = [...n.allies, ...n.enemies].filter(x => byName[x]);
    const second = first.flatMap(x => [...byName[x].allies, ...byName[x].enemies]).filter(x => byName[x] && x !== n.name && !first.includes(x));
    const names = [n.name, ...first, ...[...new Set(second)].sort((p, q) => byName[q].active30 - byName[p].active30)].slice(0, 36);
    if (mine && !names.includes(mine.name) && byName[mine.name]) names.push(mine.name);
    const idx = Object.fromEntries(names.map((x, i) => [x, i]));
    const edges = [];
    names.forEach((x, i) => { for (const y of byName[x].allies) if (idx[y] > i) edges.push([i, idx[y], "ally"]); for (const y of byName[x].enemies) if (idx[y] > i) edges.push([i, idx[y], "enemy"]); });
    // force layout: springs on links (enemies pushed apart), repulsion between all, the nation pinned at the centre
    const P = names.map((_, i) => i ? { x:W / 2 + Math.cos(i * 2.4) * (120 + i * 6), y:H / 2 + Math.sin(i * 2.4) * (90 + i * 4) } : { x:W / 2, y:H / 2 });
    for (let it = 0; it < 320; it++) {
      const f = P.map(() => ({ x:0, y:0 }));
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d2 = Math.max(80, dx * dx + dy * dy), k = 9000 / d2, d = Math.sqrt(d2);
        f[i].x -= dx / d * k; f[i].y -= dy / d * k; f[j].x += dx / d * k; f[j].y += dy / d * k;
      }
      for (const [i, j, type] of edges) {
        const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d = Math.max(1, Math.hypot(dx, dy)), want = type === "ally" ? 110 : 230, k = (d - want) * 0.02;
        f[i].x += dx / d * k; f[i].y += dy / d * k; f[j].x -= dx / d * k; f[j].y -= dy / d * k;
      }
      for (let i = 1; i < P.length; i++) {
        P[i].x = Math.min(W - 60, Math.max(60, P[i].x + Math.max(-12, Math.min(12, f[i].x + (W / 2 - P[i].x) * 0.004))));
        P[i].y = Math.min(H - 30, Math.max(30, P[i].y + Math.max(-12, Math.min(12, f[i].y + (H / 2 - P[i].y) * 0.006))));
      }
    }
    webLayout = { key:n.name + "|" + nations.length, names, edges, P, hover:-1 };
    c.onmousemove = ev => { const r = c.getBoundingClientRect(), mx = (ev.clientX - r.left) * W / r.width, my = (ev.clientY - r.top) * H / r.height;
      const h = webLayout.P.findIndex(p => Math.hypot(p.x - mx, p.y - my) < 18); if (h !== webLayout.hover) { webLayout.hover = h; c.style.cursor = h >= 0 ? "pointer" : "default"; paintWeb(); } };
    c.onclick = () => { const h = webLayout.hover; if (h > 0) { selNation = webLayout.names[h]; renderNations(); } };
  }
  paintWeb();
  function paintWeb() {
    const { names, edges, P, hover } = webLayout;
    g.fillStyle = "#070707"; g.fillRect(0, 0, W, H);
    for (const [i, j, type] of edges) {
      const lit = hover < 0 || hover === i || hover === j;
      g.strokeStyle = alpha(type === "ally" ? COL.blue : COL.red, lit ? .7 : .12); g.lineWidth = type === "ally" ? 1.5 : 1.2;
      g.setLineDash(type === "ally" ? [] : [5, 5]); g.beginPath(); g.moveTo(P[i].x, P[i].y); g.lineTo(P[j].x, P[j].y); g.stroke();
    }
    g.setLineDash([]);
    names.forEach((name, i) => {
      const x = byName[name], r = 4 + Math.min(16, Math.sqrt(x.active30 || 1) * 1.6), isMine = mine && name === mine.name;
      g.fillStyle = i === 0 ? "#fff" : isMine ? COL.hq : n.allies.includes(name) ? COL.blue : n.enemies.includes(name) ? COL.red : "#5a5a5a";
      g.globalAlpha = hover < 0 || hover === i || edges.some(([a, b]) => (a === hover && b === i) || (b === hover && a === i)) ? 1 : .3;
      g.beginPath(); g.arc(P[i].x, P[i].y, r, 0, 7); g.fill();
      g.fillStyle = i === 0 || hover === i ? "#fff" : COL.mut; g.font = `${i === 0 ? 600 : 400} ${i === 0 ? 14 : 12}px Inter Tight, sans-serif`; g.textAlign = "center";
      g.fillText(name, P[i].x, P[i].y - r - 7); g.globalAlpha = 1;
    });
  }
}

// ---- war room package ----
function warRoomPackage() {
  const now = Date.now();
  const ruins = towns.filter(t => t.c && ((t.ruined && t.ruinedAt && now - t.ruinedAt < 2 * 864e5) || isSoon(t)))
    .map(t => ({ t, eta:t.ruined ? t.ruinedAt : now + etaOf(t) })).sort((a, b) => a.eta - b.eta).slice(0, 60)
    .map(({ t, eta }) => ({ town:t.name, kind:"ruin", nation:t.nation || "", x:t.c.x, z:t.c.z, eta:Math.round(eta), gold:t.balance ?? null, warp:t.near?.name || "" }));
  const over = towns.filter(isOverTarget).map(t => ({ t, o:overclaim(t) })).sort((a, b) => b.o.takeable - a.o.takeable || b.o.soonExcess - a.o.soonExcess).slice(0, 60)
    .map(({ t, o }) => ({ town:t.name, kind:"overclaim", nation:t.nation || "", x:t.c?.x ?? null, z:t.c?.z ?? null, chunks:o.takeable || o.soonExcess, warp:t.near?.name || "" }));
  return { kind:"bleeding-heart-intel", v:1, at:now, hq:hqTown()?.name || "", towns:towns.length, ruined:towns.filter(t => t.ruined).length,
    purgeMin:learned.purgeMin, nations:nationSnap(), candidates:[...ruins, ...over] };
}
function showToast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600); }
async function sendToWarRoom() {
  if (!towns.length) return status("Run a scan first, then send it to the war room.");
  const text = JSON.stringify(warRoomPackage());
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch {}
  if (!copied) { // older browsers / file pages: fall back to a selected textarea
    const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
    try { copied = document.execCommand("copy"); } catch {} ta.remove();
  }
  showToast(copied ? "Scan copied. Paste it into the war room's Import tab." : "Couldn't copy automatically. Try again from Chrome or Edge.");
  if (copied) window.open(WAR_ROOM + "#import", "_blank", "noopener");
}

// remember which dossier folds are open across redraws
const openFolds = new Set();
document.addEventListener("toggle", e => { const k = e.target.dataset?.fold; if (k) e.target.open ? openFolds.add(k) : openFolds.delete(k); }, true);
const fold = k => `data-fold="${k}" ${openFolds.has(k) ? "open" : ""}`;
