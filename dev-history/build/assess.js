/* ---------- Ministry of Intelligence: nation assessments ----------
   Every nation gets five 0-100 scores, recomputed from each scan, and a plain-language brief.
   - Risk: how exposed it is to losing towns or land soon (towns about to ruin, overclaimable land,
     inactive members, an inactive leader, shrinking since the last scan, thin banks per town).
   - Hostility / Friendliness toward Bleeding Heart: direct alliances and enmities, then second-order
     links (allied with our enemies, enemies of our allies, shared allies, shared enemies), plus how
     many of their towns sit close to ours.
   - Strength: active members, land, gold and allies, as percentiles against every other nation.
   - Momentum: change in active members and land since the previous saved scan.
   Stance is read from the relation scores: Home, Ally, Friendly, Neutral, Wary or Hostile. */
const CONTACT_RANGE = 1500; // blocks between towns that counts as "on our border"
const STANCE = {
  home:{ label:"Home", c:"var(--hq)" }, ally:{ label:"Ally", c:"var(--blue)" }, friendly:{ label:"Friendly", c:"var(--green)" },
  neutral:{ label:"Neutral", c:"var(--mut)" }, wary:{ label:"Wary", c:"var(--orange)" }, hostile:{ label:"Hostile", c:"var(--red)" },
};
const riskLevel = r => r >= 65 ? { label:"Critical", c:"var(--red)" } : r >= 45 ? { label:"High", c:"var(--orange)" } : r >= 25 ? { label:"Moderate", c:"var(--gold)" } : { label:"Low", c:"var(--green)" };
let assessCache = { key:"", map:new Map() };

function assessAll() {
  const home = findNation($("myNation").value);
  const key = [nations.length, towns.length, home?.name, scanHistory.length, days(), ocWindow(), ocInactive()].join("|");
  if (assessCache.key === key) return assessCache.map;
  const pctOf = vals => { const s = [...vals].sort((a, b) => a - b); return v => s.length < 2 ? 0.5 : s.findIndex(x => x >= v) / (s.length - 1); };
  const pA = pctOf(nations.map(n => n.active30)), pC = pctOf(nations.map(n => n.chunks)), pG = pctOf(nations.map(goldOf)), pAl = pctOf(nations.map(n => n.allies.length));
  const pGT = pctOf(nations.map(n => goldOf(n) / Math.max(1, n.towns.length)));
  // our towns, for border contact
  const ours = home ? home.towns.filter(t => t.c && !t.ruined) : [];
  const has = (list, name) => list.some(x => x.toLowerCase() === String(name || "").toLowerCase());
  const map = new Map();
  for (const n of nations) {
    const live = n.towns.filter(t => !t.ruined), T = Math.max(1, live.length);
    const falling = live.filter(isSoon).length, take = live.reduce((s, t) => s + (overclaim(t)?.takeable || 0), 0);
    const activeRate = n.known ? n.active30 / n.known : 0.5;
    const leaderGone = n.kingLast != null && Date.now() - n.kingLast > days() * 864e5;
    const dA = deltaOf(n.name, "a"), dC = deltaOf(n.name, "c");
    const decline = dA != null && n.active30 > 0 ? Math.max(0, Math.min(1, -dA / Math.max(5, n.active30) * 3)) : 0;
    const risk = Math.round(100 * Math.min(1,
      0.25 * Math.min(1, falling / T * 4) + 0.20 * Math.min(1, take / Math.max(1, n.chunks) * 5) + 0.25 * (1 - Math.min(1, activeRate)) +
      0.10 * (leaderGone ? 1 : 0) + 0.10 * decline + 0.10 * (1 - pGT(goldOf(n) / T))));
    const strength = Math.round(100 * (0.4 * pA(n.active30) + 0.25 * pC(n.chunks) + 0.2 * pG(goldOf(n)) + 0.15 * pAl(n.allies.length)));
    // relations to Bleeding Heart
    let hostility = 0, friendliness = 0, contact = 0, reasons = [];
    if (home && n !== home) {
      const allyDirect = has(n.allies, home.name) || has(home.allies, n.name), enemyDirect = has(n.enemies, home.name) || has(home.enemies, n.name);
      if (allyDirect) { friendliness += 60; reasons.push("allied with us"); }
      if (enemyDirect) { hostility += 60; reasons.push("an enemy of ours"); }
      const withOurEnemies = n.allies.filter(x => has(home.enemies, x)), againstOurAllies = n.enemies.filter(x => has(home.allies, x));
      const sharedAllies = n.allies.filter(x => has(home.allies, x)), sharedEnemies = n.enemies.filter(x => has(home.enemies, x));
      hostility += withOurEnemies.length * 15 + againstOurAllies.length * 12;
      friendliness += sharedAllies.length * 8 + sharedEnemies.length * 10;
      if (withOurEnemies.length) reasons.push(`allied with ${withOurEnemies.length === 1 ? "our enemy " + withOurEnemies[0] : withOurEnemies.length + " of our enemies"}`);
      if (againstOurAllies.length) reasons.push(`hostile to ${againstOurAllies.length === 1 ? "our ally " + againstOurAllies[0] : againstOurAllies.length + " of our allies"}`);
      if (sharedEnemies.length) reasons.push(`shares ${sharedEnemies.length === 1 ? "an enemy" : sharedEnemies.length + " enemies"} with us`);
      if (sharedAllies.length) reasons.push(`shares ${sharedAllies.length === 1 ? "an ally" : sharedAllies.length + " allies"} with us`);
      for (const t of live) if (t.c && ours.some(o => Math.abs(o.c.x - t.c.x) < CONTACT_RANGE && Math.abs(o.c.z - t.c.z) < CONTACT_RANGE && Math.hypot(o.c.x - t.c.x, o.c.z - t.c.z) < CONTACT_RANGE)) contact++;
      if (contact && friendliness < 40) hostility += Math.min(15, contact * 3);
      if (n.isNeutral) { hostility = Math.round(hostility * 0.5); friendliness = Math.round(friendliness * 0.8); }
      hostility = Math.min(100, Math.round(hostility)); friendliness = Math.min(100, Math.round(friendliness));
    }
    const stance = !home ? "neutral" : n === home ? "home" : (has(n.allies, home.name) || has(home.allies, n.name)) ? "ally" : (has(n.enemies, home.name) || has(home.enemies, n.name)) ? "hostile"
      : friendliness - hostility >= 15 ? "friendly" : hostility - friendliness >= 15 ? (hostility >= 40 ? "hostile" : "wary") : "neutral";
    const flags = [];
    if (risk >= 45 && ["hostile", "wary", "neutral"].includes(stance) && contact) flags.push("Prime target");
    else if (risk >= 45 && ["hostile", "wary"].includes(stance)) flags.push("Vulnerable rival");
    if (strength >= 70 && ["hostile", "wary"].includes(stance)) flags.push("Threat");
    if (risk >= 55 && ["ally", "friendly"].includes(stance)) flags.push("Ally at risk");
    map.set(n.name, { risk, strength, hostility, friendliness, stance, contact, reasons, falling, take, activeRate, leaderGone, dA, dC, flags });
  }
  assessCache = { key, map };
  return map;
}
const assess = n => n ? assessAll().get(n.name) : null;

// a plain-language brief anyone in the department can read or paste into Discord
function nationBrief(n, plain) {
  const a = assess(n); if (!a) return "";
  const size = a.strength >= 75 ? "a major power" : a.strength >= 50 ? "a mid-sized nation" : a.strength >= 25 ? "a small nation" : "a minor nation";
  const trend = a.dA == null ? "" : a.dA >= 3 ? ", growing" : a.dA <= -3 ? ", shrinking" : ", holding steady";
  const s1 = `${n.name} is ${size}${trend}: ${townsN(n.towns.length)}, ${n.active30} active members in the last 30 days and ${n.chunks.toLocaleString()} chunks.`;
  const rel = a.stance === "home" ? "This is Bleeding Heart's own nation." :
    `Stance toward Bleeding Heart: ${STANCE[a.stance].label.toLowerCase()}${a.reasons.length ? ` (${a.reasons.slice(0, 3).join(", ")})` : ""}.${a.contact ? ` ${townsN(a.contact)} within ${CONTACT_RANGE.toLocaleString()} blocks of ours.` : ""}`;
  const why = [a.falling && `${townsN(a.falling)} could ruin within 3 days`, a.take && `${chunks(a.take)} can be overclaimed now`, a.activeRate < 0.4 && `only ${Math.round(a.activeRate * 100)}% of members are active`, a.leaderGone && "the leader is inactive"].filter(Boolean);
  const s3 = `Risk is ${riskLevel(a.risk).label.toLowerCase()} (${a.risk}/100)${why.length ? `: ${why.join(", ")}` : ""}.`;
  const s4 = a.flags.length ? `Assessment: ${a.flags.join(", ")}.` : "";
  const text = [s1, rel, s3, s4].filter(Boolean).join(" ");
  return plain ? text : esc(text);
}
function briefForSharing(n) {
  const a = assess(n);
  return [`**${n.name}** · ${STANCE[a.stance].label} · Risk ${a.risk}/100 (${riskLevel(a.risk).label})`,
    `Strength ${a.strength} · Hostility ${a.hostility} · Friendliness ${a.friendliness}${a.dA != null ? ` · Active ${a.dA >= 0 ? "+" : ""}${a.dA} since last scan` : ""}`,
    nationBrief(n, true), `— Bleeding Heart · Ministry of Intelligence, ${new Date().toLocaleDateString()}`].join("\n");
}
const meter = (label, v, c, tip) => `<div class="meter" title="${esc(tip)}"><div class="m-top"><span>${label}</span><b>${v}</b></div><div class="m-bar"><div style="width:${v}%;background:${c}"></div></div></div>`;

// ---- map lens for the Ministry of Intelligence ----
let intelLens = "stance";
try { intelLens = localStorage.getItem("rh_lens") || "stance"; } catch {}
const RISK_COL = r => r >= 65 ? COL.red : r >= 45 ? COL.orange : r >= 25 ? COL.gold : COL.green;
function drawIntelLayer(placed, zoomR, dot, spike) {
  const map = assessAll(), sel = nations.find(x => x.name === selNation), home = findNation($("myNation").value);
  const col = { home:COL.hq, ally:COL.blue, friendly:COL.green, neutral:"rgba(255,255,255,.35)", wary:COL.orange, hostile:COL.red };
  // front lines: our towns to nearby wary/hostile towns
  if (home && $("lensFront")?.checked !== false) {
    const ours = home.towns.filter(t => t.c && !t.ruined), lines = [];
    for (const t of placed) {
      if (t.ruined || !t.nation || t.nation === home.name) continue;
      const st = map.get(t.nation)?.stance; if (st !== "hostile" && st !== "wary") continue;
      for (const o of ours) { const d = Math.hypot(o.c.x - t.c.x, o.c.z - t.c.z); if (d < CONTACT_RANGE) lines.push([o, t, st, d]); }
      if (lines.length > 400) break;
    }
    ctx.setLineDash([4 * M.dpr, 4 * M.dpr]); ctx.lineWidth = M.dpr;
    for (const [o, t, st] of lines) { const A = townScreen(o), B = townScreen(t); if (A[2] <= 0 || B[2] <= 0) continue;
      ctx.strokeStyle = alpha(st === "hostile" ? COL.red : COL.orange, .45); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  for (const t of placed) {
    if (t.ruined) continue;
    const a = t.nation ? map.get(t.nation) : null, mineSel = sel && t.nation === sel.name;
    let c, r = (1.6 + Math.min(2.4, Math.sqrt(t.blocks || 1) / 4)) * zoomR;
    if (intelLens === "risk") c = a ? RISK_COL(a.risk) : "rgba(255,255,255,.25)";
    else if (intelLens === "activity") { const k = t.count ? t.active / t.count : 0; c = `rgba(255,255,255,${(0.15 + k * 0.85).toFixed(2)})`; }
    else c = a ? col[a.stance] : "rgba(255,255,255,.22)";
    if (sel && !mineSel) c = alpha(c.startsWith("var") ? COL.fg : c, .45);
    if (mineSel) r *= 1.5;
    dot(t, r, c, mineSel ? 8 : intelLens === "risk" && a?.risk >= 65 ? 6 : 0);
    if (intelLens === "risk" && (isSoon(t) || isOverclaimable(t))) spike(t, 0.05, isSoon(t) ? COL.red : COL.purple);
  }
  // selected nation: ring its capital and outline its towns
  if (sel) for (const t of sel.towns) if (t.c && !t.ruined) {
    const [x, y, d] = townScreen(t); if (d <= 0) continue;
    ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = M.dpr; ctx.beginPath(); ctx.arc(x, y, (t.name === sel.capital ? 9 : 5) * M.dpr, 0, 7); ctx.stroke();
  }
  // nation labels at the centre of their towns (largest nations, plus the selected one)
  if ($("lensLabels")?.checked !== false) {
    const top = [...nations].sort((p, q) => q.chunks - p.chunks).slice(0, 14);
    if (sel && !top.includes(sel)) top.push(sel);
    ctx.font = `600 ${11 * M.dpr}px Inter Tight, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const n of top) {
      const pts = n.towns.filter(t => t.c && !t.ruined); if (!pts.length) continue;
      const cx = pts.reduce((s, t) => s + t.c.x, 0) / pts.length, cz = pts.reduce((s, t) => s + t.c.z, 0) / pts.length;
      const [x, y, d] = townScreen({ c:{ x:cx, z:cz } }); if (d <= 0) continue;
      const a = map.get(n.name), label = n.name.replace(/_/g, " ").toUpperCase(), w = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x - w / 2 - 6 * M.dpr, y - 9 * M.dpr, w + 12 * M.dpr, 18 * M.dpr);
      ctx.fillStyle = n === sel ? "#fff" : a ? (a.stance === "home" ? COL.hq : a.stance === "hostile" ? COL.red : a.stance === "ally" ? COL.blue : "rgba(255,255,255,.75)") : "#fff";
      ctx.fillText(label, x, y);
    }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
}
// fit the camera to a nation's towns
function frameNation(n) {
  const pts = n?.towns.filter(t => t.c && !t.ruined).map(t => t.c); if (!pts?.length) return;
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * M.W / M.H, 1500);
  if (M.mode === "flat") { M.fly = null; const target = Math.min(2, M.W / (span * 1.5)); const from = { cx:M.cx, cz:M.cz, scale:M.scale }, t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / 900), e = 1 - Math.pow(1 - k, 3); M.cx = from.cx + (cx - from.cx) * e; M.cz = from.cz + (cz - from.cz) * e; M.scale = from.scale * Math.pow(target / from.scale, e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step); }
  else flyTo({ c:{ x:cx, z:cz } });
}
