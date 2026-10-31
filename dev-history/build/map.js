/* ---------- Map: world underlay, flat + globe views, Bleeding Heart HQ ----------
   EarthMC worlds are scaled maps of Earth. Block coordinates convert to longitude/latitude with
   a projection (equirectangular by default, Miller as an option) and a scale ("half-width":
   blocks from the centre to 180°). After each scan the scale is auto-calibrated by finding the
   one that puts the most towns on land; it can be overridden in Filters & settings. */
const GEO = __GEO__;
const LAND = Uint8Array.from(atob(GEO.mask), c => c.charCodeAt(0));
const isLand = (lon, lat) => {
  const col = Math.min(359, Math.max(0, Math.floor(lon + 180))), row = Math.min(179, Math.max(0, Math.floor(90 - lat)));
  const k = row * 360 + col; return (LAND[k >> 3] >> (k & 7)) & 1;
};
const LAND_CELLS = [];
for (let row = 0; row < 180; row++) for (let col = 0; col < 360; col++) if (isLand(col - 179.5, 89.5 - row)) LAND_CELLS.push(col - 179.5, 89.5 - row);
const RAD = Math.PI / 180;

let proj = { type:"equirect", half:33280, offX:0, offZ:0, score:null, auto:true };
try { Object.assign(proj, JSON.parse(localStorage.getItem("rh_proj") || "{}")); } catch {}
const saveProj = () => { try { localStorage.setItem("rh_proj", JSON.stringify(proj)); } catch {} };

function geoOf(x, z, p = proj) {
  const lon = (x - p.offX) / p.half * 180;
  if (p.type === "miller") { const y = -(z - p.offZ) / p.half * Math.PI; return [lon, (Math.atan(Math.exp(y / 1.25)) - Math.PI / 4) / 0.4 / RAD]; }
  return [lon, -(z - p.offZ) / (p.half / 2) * 90];
}
function mcOf(lon, lat, p = proj) {
  const x = lon / 180 * p.half + p.offX;
  if (p.type === "miller") return [x, -1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD)) / Math.PI * p.half + p.offZ];
  return [x, -lat / 90 * (p.half / 2) + p.offZ];
}

// Find the scale/projection that puts the most towns on land.
function calibrateMap() {
  const pts = towns.filter(t => t.c && !t.ruined).map(t => t.c);
  if (pts.length < 20 || !proj.auto) return;
  const sample = pts.length > 800 ? pts.filter((_, i) => i % Math.ceil(pts.length / 800) === 0) : pts;
  const maxX = Math.max(...pts.map(p => Math.abs(p.x)));
  const score = p => { let hit = 0; for (const c of sample) { const [lo, la] = geoOf(c.x, c.z, p); if (Math.abs(lo) <= 180 && Math.abs(la) <= 90 && isLand(lo, la)) hit++; } return hit / sample.length; };
  let best = { score:-1 };
  // the farthest town sits between 90° and 180° of longitude from the centre
  for (const type of ["equirect", "miller"]) for (let half = maxX; half <= maxX * 2; half *= 1.01) {
    const p = { type, half, offX:0, offZ:0 }, s = score(p);
    if (s > best.score) best = { ...p, score:s };
  }
  for (let half = best.half * 0.985; half <= best.half * 1.015; half *= 1.001) {
    const p = { type:best.type, half, offX:0, offZ:0 }, s = score(p);
    if (s > best.score) best = { ...p, score:s };
  }
  if (best.score >= 0.55) Object.assign(proj, best, { half:Math.round(best.half) });
  else proj.score = best.score;
  saveProj(); landPath = null;
}

// ---- Bleeding Heart: the site's home town ----
const HQ_KEY = "bleedingheart", normName = s => (s || "").toLowerCase().replace(/[\s_\-']+/g, "");
function hqTown() {
  const direct = towns.find(t => normName(t.name) === HQ_KEY);
  if (direct) return direct;
  const n = nations.find(n => normName(n.name) === HQ_KEY);
  return n ? (n.towns.find(t => t.name === n.capital) || [...n.towns].sort((a, b) => (b.blocks || 0) - (a.blocks || 0))[0] || null) : null;
}

// ---- view state ----
const cv = $("map"), ctx = cv.getContext("2d");
const M = { mode:"flat", cx:0, cz:0, scale:0.02, lon0:10, lat0:25, gz:1, W:1, H:1, dpr:1, hits:[], drag:null, idleAt:0, fly:null };
try { M.mode = localStorage.getItem("rh_mapMode") || "flat"; } catch {}
function sizeMap() {
  const r = cv.getBoundingClientRect(); M.dpr = Math.min(2, devicePixelRatio || 1);
  M.W = Math.max(1, Math.round(r.width * M.dpr)); M.H = Math.max(1, Math.round(r.height * M.dpr));
  if (cv.width !== M.W || cv.height !== M.H) { cv.width = M.W; cv.height = M.H; base.key = ""; }
}
addEventListener("resize", sizeMap);
function fitWorld() {
  calibrateMap(); sizeMap();
  const cs = towns.filter(t => t.c).map(t => t.c);
  if (!cs.length) return;
  const xs = cs.map(c => c.x), zs = cs.map(c => c.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  M.cx = (minX + maxX) / 2; M.cz = (minZ + maxZ) / 2;
  M.scale = Math.min(M.W / ((maxX - minX) * 1.08 || 1), M.H / ((maxZ - minZ) * 1.12 || 1));
  const hq = hqTown();
  if (hq?.c) { const [lo, la] = geoOf(hq.c.x, hq.c.z); M.lon0 = lo; M.lat0 = Math.max(-60, Math.min(60, la)); }
  if (hq && !$("myTown").value.trim()) $("myTown").value = hq.name;
  if (!$("myNation").value.trim()) $("myNation").value = hq?.nation || "Bleeding_Heart";
  showMapNote();
}
function showMapNote() {
  const el = $("mapNote"); if (!el) return;
  el.innerHTML = proj.score == null ? "World underlay: default scale"
    : proj.score >= 0.55 ? `World underlay aligned · ${Math.round(proj.score * 100)}% of towns on land · ${proj.type === "miller" ? "Miller" : "equirectangular"}, ${proj.half.toLocaleString()} blocks to 180°`
    : `World underlay may be misaligned (${Math.round(proj.score * 100)}% of towns on land). Adjust it in Filters & settings.`;
  if ($("projHalf")) { $("projHalf").value = proj.half; $("projType").value = proj.auto ? "auto" : proj.type; }
}

// ---- flat projection (device pixels) ----
const fx = x => (x - M.cx) * M.scale + M.W / 2, fz = z => (z - M.cz) * M.scale + M.H / 2;
// ---- globe projection: returns [x, y, depth] or null when on the far side ----
function gp(lon, lat, lift = 0) {
  const R = Math.min(M.W, M.H) * 0.42 * M.gz * (1 + lift), l = (lon - M.lon0) * RAD, p = lat * RAD, p0 = M.lat0 * RAD;
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
  return [M.W / 2 + R * Math.cos(p) * Math.sin(l), M.H / 2 - R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)), cosc];
}
const townScreen = t => { if (M.mode === "flat") return [fx(t.c.x), fz(t.c.z), 1]; const [lo, la] = geoOf(t.c.x, t.c.z); return gp(lo, la); };

// ---- cached base layer (land) for the flat view ----
let landPath = null;
const base = document.createElement("canvas"); base.key = "";
function buildLandPath() {
  landPath = new Path2D();
  for (const r of GEO.rings) {
    for (let i = 0; i < r.length; i += 2) { const [x, z] = mcOf(r[i], r[i + 1]); i ? landPath.lineTo(x, z) : landPath.moveTo(x, z); }
    landPath.closePath();
  }
}
function drawFlatLand(g, W, H, cx, cz, scale, dpr) {
  if (!landPath) buildLandPath();
  g.fillStyle = "#070707"; g.fillRect(0, 0, W, H);
  // graticule every 30°
  g.strokeStyle = "rgba(255,255,255,.045)"; g.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) { const x = (mcOf(lon, 0)[0] - cx) * scale + W / 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let lat = -60; lat <= 60; lat += 30) { const y = (mcOf(0, lat)[1] - cz) * scale + H / 2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.save(); g.setTransform(scale, 0, 0, scale, W / 2 - cx * scale, H / 2 - cz * scale);
  g.fillStyle = "rgba(255,255,255,.035)"; g.fill(landPath, "evenodd");
  g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = dpr / scale; g.stroke(landPath);
  g.restore();
  // halftone dots on land
  const cell = (mcOf(1, 0)[0] - mcOf(0, 0)[0]) * scale;
  if (cell > 2.2 * dpr) {
    g.fillStyle = "rgba(255,255,255,.10)";
    const rr = Math.min(cell * 0.18, 2.2 * dpr);
    for (let i = 0; i < LAND_CELLS.length; i += 2) {
      const [x, z] = mcOf(LAND_CELLS[i], LAND_CELLS[i + 1]), sx = (x - cx) * scale + W / 2, sy = (z - cz) * scale + H / 2;
      if (sx < -5 || sy < -5 || sx > W + 5 || sy > H + 5) continue;
      g.fillRect(sx - rr / 2, sy - rr / 2, rr, rr);
    }
  }
}

function drawGlobeBase() {
  const R = Math.min(M.W, M.H) * 0.42 * M.gz, cx = M.W / 2, cy = M.H / 2;
  ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, M.W, M.H);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
  halo.addColorStop(0, "rgba(255,255,255,.06)"); halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 7); ctx.fill();
  const sph = ctx.createRadialGradient(cx - R * .35, cy - R * .4, R * .1, cx, cy, R);
  sph.addColorStop(0, "#1a1a1a"); sph.addColorStop(1, "#080808");
  ctx.fillStyle = sph; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = M.dpr; ctx.stroke();
  // graticule
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  const line = pts => { ctx.beginPath(); let on = false; for (const [lo, la] of pts) { const [x, y, d] = gp(lo, la); if (d > 0) { on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; } else on = false; } ctx.stroke(); };
  for (let lon = -180; lon < 180; lon += 30) line(Array.from({ length:37 }, (_, i) => [lon, -90 + i * 5]));
  for (let lat = -60; lat <= 60; lat += 30) line(Array.from({ length:73 }, (_, i) => [-180 + i * 5, lat]));
  // land as a dot matrix, fading toward the edge
  const s = Math.max(1.2, R / 260) * (M.gz > 2 ? 1.3 : 1);
  for (let i = 0; i < LAND_CELLS.length; i += 2) {
    const [x, y, d] = gp(LAND_CELLS[i], LAND_CELLS[i + 1]);
    if (d <= 0) continue;
    ctx.fillStyle = `rgba(255,255,255,${(0.08 + d * 0.32).toFixed(3)})`;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
}

// ---- frame ----
function drawMap() {
  if (document.body.dataset.page === "dossier" || document.hidden) return;
  if (!M.W || M.W === 1) sizeMap();
  animateCamera();
  const W = M.W, H = M.H, dpr = M.dpr;
  if (M.mode === "flat") {
    const key = [M.cx, M.cz, M.scale, W, H, proj.half, proj.type].join();
    if (base.key !== key) { base.width = W; base.height = H; drawFlatLand(base.getContext("2d"), W, H, M.cx, M.cz, M.scale, dpr); base.key = key; }
    ctx.drawImage(base, 0, 0);
  } else {
    if (Date.now() - M.idleAt > 4000 && !M.drag && !M.fly && !reduceMotion) M.lon0 += 0.04;
    drawGlobeBase();
  }

  M.hits = [];
  const dot = (t, r, col, glow) => {
    const [x, y, d] = townScreen(t); if (d <= 0 || x < -20 || y < -20 || x > W + 20 || y > H + 20) return null;
    if (glow) { ctx.shadowColor = col; ctx.shadowBlur = glow * dpr; }
    ctx.globalAlpha = M.mode === "globe" ? 0.35 + d * 0.65 : 1;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r * dpr, 0, 7); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    M.hits.push({ t, x, y }); return [x, y];
  };
  // globe: targets rise as spikes
  const spike = (t, h, col) => {
    if (M.mode !== "globe") return;
    const [lo, la] = geoOf(t.c.x, t.c.z), a = gp(lo, la), b = gp(lo, la, h);
    if (a[2] <= 0) return;
    const gr = ctx.createLinearGradient(a[0], a[1], b[0], b[1]); gr.addColorStop(0, col); gr.addColorStop(1, alpha(col, 0));
    ctx.strokeStyle = gr; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  };
  const placed = towns.filter(t => t.c);
  const zoomR = M.mode === "flat" ? Math.min(1.6, Math.max(0.8, M.scale * 60)) : 1;
  placed.forEach(t => dot(t, 1.3 * zoomR, "rgba(255,255,255,.28)"));
  (window.__warps || []).forEach(w => { const [x, y, d] = townScreen(w); if (d > 0) { ctx.fillStyle = alpha(COL.blue, .7); ctx.fillRect(x - dpr, y - dpr, 2 * dpr, 2 * dpr); } });
  if (tab === "over") {
    placed.filter(t => isOverTarget(t) && !isOverclaimable(t)).forEach(t => { spike(t, 0.04, COL.orange); dot(t, 2.6 * zoomR, COL.orange, 6); });
    placed.filter(isOverclaimable).forEach(t => { spike(t, 0.03 + Math.min(0.12, overclaim(t).takeable / 300), COL.purple); dot(t, 3 * zoomR, COL.purple, 8); });
  } else {
    placed.forEach(t => { if (isSoon(t)) { spike(t, 0.06, COL.orange); dot(t, 2.6 * zoomR, COL.orange, 6); } });
    placed.filter(t => t.ruined).forEach(t => { spike(t, 0.09, COL.red); dot(t, 3 * zoomR, COL.red, 8); });
  }

  const t = selected;
  if (t?.c) {
    if (t.near) {
      const A = townScreen(t.near), B = townScreen(t);
      if (A[2] > 0 && B[2] > 0) {
        ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.lineDashOffset = -Date.now() / 40; ctx.strokeStyle = alpha(COL.fg, .7); ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COL.blue; ctx.beginPath(); ctx.arc(A[0], A[1], 3.5 * dpr, 0, 7); ctx.fill();
      }
    }
    const [x, y, d] = townScreen(t);
    if (d > 0) {
      const ping = (Date.now() % 1600) / 1600;
      ctx.strokeStyle = `rgba(255,255,255,${1 - ping})`; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(x, y, (6 + ping * 26) * dpr, 0, 7); ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = dpr; const a = 7 * dpr, b = 17 * dpr;
      ctx.beginPath(); ctx.moveTo(x - b, y); ctx.lineTo(x - a, y); ctx.moveTo(x + a, y); ctx.lineTo(x + b, y);
      ctx.moveTo(x, y - b); ctx.lineTo(x, y - a); ctx.moveTo(x, y + a); ctx.lineTo(x, y + b); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, 7); ctx.fill();
    }
  }
  drawHQ(ctx, townScreen, dpr, M.mode === "globe");
  if (M.mode === "flat") radarSweep(ctx, W, H);
}

// Bleeding Heart HQ marker: a crimson heart with a slow pulse and a label
function heartPath(g, x, y, s) {
  g.beginPath(); g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.4, x, y - s * 0.45);
  g.bezierCurveTo(x + s * 0.7, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
  g.closePath();
}
function drawHQ(g, screenOf, dpr, beacon) {
  const hq = hqTown(); if (!hq?.c) return;
  const [x, y, d] = screenOf(hq); if (d <= 0) return;
  const pulse = (Date.now() % 2200) / 2200;
  if (beacon) { // tall light beam on the globe
    const [lo, la] = geoOf(hq.c.x, hq.c.z), top = gp(lo, la, 0.22);
    const gr = g.createLinearGradient(x, y, top[0], top[1]); gr.addColorStop(0, COL.hq); gr.addColorStop(1, alpha(COL.hq, 0));
    g.strokeStyle = gr; g.lineWidth = 2.5 * dpr; g.beginPath(); g.moveTo(x, y); g.lineTo(top[0], top[1]); g.stroke();
  }
  g.strokeStyle = alpha(COL.hq, 0.8 * (1 - pulse)); g.lineWidth = 1.5 * dpr;
  g.beginPath(); g.arc(x, y, (9 + pulse * 30) * dpr, 0, 7); g.stroke();
  g.shadowColor = COL.hq; g.shadowBlur = 14 * dpr;
  g.fillStyle = COL.hq; heartPath(g, x, y, 6.5 * dpr * (1 + Math.sin(Date.now() / 300) * 0.06)); g.fill();
  g.shadowBlur = 0;
  g.font = `600 ${11 * dpr}px Inter Tight, sans-serif`; g.textBaseline = "middle";
  const label = "BLEEDING HEART · HQ", tw = g.measureText(label).width;
  g.fillStyle = "rgba(0,0,0,.65)"; g.fillRect(x + 14 * dpr, y - 9 * dpr, tw + 12 * dpr, 18 * dpr);
  g.fillStyle = "#fff"; g.fillText(label, x + 20 * dpr, y);
}

// ---- camera animation ----
function flyTo(t) {
  if (!t?.c) return;
  const [lo, la] = geoOf(t.c.x, t.c.z);
  M.fly = { t0:performance.now(), from:{ cx:M.cx, cz:M.cz, lon0:M.lon0, lat0:M.lat0 },
    to:{ cx:t.c.x, cz:t.c.z, lon0:M.lon0 + ((((lo - M.lon0) % 360) + 540) % 360 - 180), lat0:Math.max(-70, Math.min(70, la)) } };
}
function animateCamera() {
  if (!M.fly) return;
  const k = Math.min(1, (performance.now() - M.fly.t0) / (reduceMotion ? 1 : 900)), e = 1 - Math.pow(1 - k, 3), f = M.fly.from, to = M.fly.to;
  if (M.mode === "flat") { M.cx = f.cx + (to.cx - f.cx) * e; M.cz = f.cz + (to.cz - f.cz) * e; }
  else { M.lon0 = f.lon0 + (to.lon0 - f.lon0) * e; M.lat0 = f.lat0 + (to.lat0 - f.lat0) * e; }
  if (k >= 1) { M.fly = null; M.idleAt = Date.now(); }
}

// ---- interaction ----
function pick(ev) {
  const r = cv.getBoundingClientRect(), mx = (ev.clientX - r.left) * M.dpr, my = (ev.clientY - r.top) * M.dpr;
  let best = null, bd = 14 * M.dpr;
  const hq = hqTown(); if (hq?.c) { const [x, y, d] = townScreen(hq); if (d > 0 && Math.hypot(x - mx, y - my) < bd) return hq; }
  for (const h of M.hits) { const d = Math.hypot(h.x - mx, h.y - my); if (d < bd) { bd = d; best = h.t; } }
  return best;
}
function zoomAt(f, mx, my) {
  M.idleAt = Date.now(); M.fly = null;
  if (M.mode === "globe") { M.gz = Math.min(8, Math.max(0.6, M.gz * f)); return; }
  const wx = M.cx + (mx - M.W / 2) / M.scale, wz = M.cz + (my - M.H / 2) / M.scale;
  M.scale = Math.min(3, Math.max(0.002, M.scale * f));
  M.cx = wx - (mx - M.W / 2) / M.scale; M.cz = wz - (my - M.H / 2) / M.scale;
}
cv.addEventListener("wheel", ev => {
  ev.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomAt(Math.exp(-ev.deltaY * 0.0015), (ev.clientX - r.left) * M.dpr, (ev.clientY - r.top) * M.dpr);
}, { passive:false });
cv.addEventListener("pointerdown", ev => { M.drag = { x:ev.clientX, y:ev.clientY, moved:0 }; M.fly = null; cv.setPointerCapture(ev.pointerId); });
cv.addEventListener("pointermove", ev => {
  if (M.drag) {
    const dx = ev.clientX - M.drag.x, dy = ev.clientY - M.drag.y;
    M.drag.x = ev.clientX; M.drag.y = ev.clientY; M.drag.moved += Math.abs(dx) + Math.abs(dy); M.idleAt = Date.now();
    if (M.mode === "flat") { M.cx -= dx * M.dpr / M.scale; M.cz -= dy * M.dpr / M.scale; }
    else { M.lon0 -= dx * 0.35 / M.gz; M.lat0 = Math.max(-80, Math.min(80, M.lat0 + dy * 0.35 / M.gz)); }
    $("tip").style.display = "none";
    return;
  }
  const t = pick(ev), tip = $("tip");
  cv.style.cursor = t ? "pointer" : "grab";
  if (!t) { tip.style.display = "none"; return; }
  const r = $("mapWrap").getBoundingClientRect(), isHQ = t === hqTown();
  tip.innerHTML = `<b>${isHQ ? "♥ " : ""}${esc(t.name)}</b> · ${isHQ ? "Bleeding Heart headquarters" : tab === "over" ? (isOverTarget(t) ? ocState(t).text : `${t.blocks ?? "?"} / ${overclaim(t)?.limit ?? "?"} chunks`) : stateOf(t).text}`;
  tip.style.display = "block";
  tip.style.left = Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8) + "px";
  tip.style.top = (ev.clientY - r.top + 14) + "px";
});
cv.addEventListener("pointerup", ev => {
  const click = M.drag && M.drag.moved < 5; M.drag = null;
  if (click) { const t = pick(ev); if (t) { selected = t; render(); } }
});
cv.addEventListener("pointerleave", () => { $("tip").style.display = "none"; });
cv.addEventListener("dblclick", ev => { const r = cv.getBoundingClientRect(); zoomAt(2, (ev.clientX - r.left) * M.dpr, (ev.clientY - r.top) * M.dpr); });
function setMapMode(mode) {
  M.mode = mode; try { localStorage.setItem("rh_mapMode", mode); } catch {}
  document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
  if (selected) flyTo(selected);
}
document.querySelector(".mapctl").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.mode) return setMapMode(b.dataset.mode);
  const act = b.dataset.act;
  if (act === "in") zoomAt(1.6, M.W / 2, M.H / 2);
  if (act === "out") zoomAt(1 / 1.6, M.W / 2, M.H / 2);
  if (act === "fit") { M.gz = 1; fitWorld(); }
  if (act === "hq") { const hq = hqTown(); if (hq) { selected = hq; render(); } else status("Bleeding Heart wasn't found in this scan."); }
});
setMapMode(M.mode);
// fly to whatever gets selected (cards, map clicks, HQ button)
let lastFlown = null;
setInterval(() => { if (selected !== lastFlown) { lastFlown = selected; if (selected) flyTo(selected); } }, 100);
