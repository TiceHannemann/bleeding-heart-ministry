/* ---------- Briefing Room: intelligence documents ----------
   Three document types, each built as one structure that renders both on screen and as a PDF:
   - Intelligence Assessment: one nation's capabilities, intentions and outlook, from any perspective
   - Support Assessment: written for an ally: its risks, who threatens it, and what to do about it
   - Daily Intelligence Summary: the whole server, last 24 hours, threats, opportunities, forecast
   "Releasable to allies" versions drop internal recommendations and target lists. */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const dtg = d => `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
const docId = (d, code) => `BH-MOI-${d.toISOString().slice(0, 10).replace(/-/g, "")}-${d.toISOString().slice(11, 16).replace(":", "")}-${code}`;
const codeOf = name => String(name || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "XXX";
const signed = v => v == null ? "—" : (v > 0 ? "+" : "") + (Math.abs(v) >= 1e4 ? short(v) : Math.round(v).toLocaleString());
const trendWord = t => !t || t.slope == null ? (t?.d24 ? (t.d24 > 0 ? "Rising" : t.d24 < 0 ? "Falling" : "Flat") : "Insufficient data") : Math.abs(t.slope) < Math.max(0.5, Math.abs(t.cur || 0) * 0.004) ? "Flat" : t.slope > 0 ? "Rising" : "Falling";
function basisLine(name) {
  const pts = name ? seriesOf(name) : null;
  const first = name ? pts[0]?.[0] : ARCHIVE.first, scans = name ? pts.length : ARCHIVE.scans;
  return first ? `${scans.toLocaleString()} automated collection${scans === 1 ? "" : "s"} between ${new Date(first).toLocaleDateString()} and ${new Date(ARCHIVE.last || Date.now()).toLocaleDateString()}; latest scan ${new Date(ARCHIVE.last || Date.now()).toUTCString().slice(17, 22)} UTC.` : "Single scan; trends will strengthen as the archive grows.";
}
const ESTIMATIVE_NOTE = "Estimative language follows the Kingdom standard: almost certain (95% or more), highly likely (80–95%), likely (55–80%), roughly even chance (45–55%), unlikely (20–45%), highly unlikely (5–20%), remote (under 5%). Confidence reflects the depth of the archive for each subject, not the importance of the judgment.";
function docBase(kind, code, releasable, title, subject, subjectShort, to) {
  const d = new Date();
  return { kind, id:docId(d, code), dtg:dtg(d), releasable, docTitle:title, subjectShort,
    classification:releasable ? "CONFIDENTIAL // RELEASABLE TO ALLIES" : "SECRET // KINGDOM EYES ONLY",
    office:"MINISTRY OF INTELLIGENCE",
    memo:[["FROM", "Director of Intelligence, Ministry of Intelligence"], ["TO", to], ["SUBJECT", subject], ["DATE", d.toUTCString().replace(" GMT", " UTC")]],
    sections:[], signer:"Director of Intelligence",
    distribution:releasable ? "Releasable to allied governments of the Kingdom of The Bleeding Heart. Do not forward to third parties without the Ministry's consent." : "The Crown Council; Ministry of Attack (War Room). Not for release outside the Kingdom." };
}
const H = (doc, text) => doc.sections.push({ type:"h", text });
const Pp = (doc, text) => text && doc.sections.push({ type:"p", text });
const B = (doc, items) => items.filter(Boolean).length && doc.sections.push({ type:"bullets", items:items.filter(Boolean) });
const seriesPts = (name, key, scale = 1) => seriesOf(name).filter(p => p[PT[key]] != null).map(p => [p[0], p[PT[key]] * scale]);
const relTo = (n, p) => p ? assess(n, p.name) : assess(n);

// ---- Intelligence Assessment ----
function nationAssessment(n, p, releasable) {
  const a = relTo(n, p), X = anticipate(n, p), home = findNation($("myNation").value);
  const persp = p || home, cap = n.towns.find(t => t.name === n.capital), c = centroid(n.towns), pc = persp && persp !== n ? centroid(persp.towns) : null;
  const rank = [...nations].sort((x, y) => assess(y).strength - assess(x).strength).indexOf(n) + 1;
  const doc = docBase("nation", codeOf(n.name), releasable, "INTELLIGENCE ASSESSMENT", `${n.name.toUpperCase()} — CAPABILITIES, INTENTIONS AND OUTLOOK`, n.name.toUpperCase(),
    releasable ? "Allied governments of the Kingdom of The Bleeding Heart" : "The Crown Council; Ministry of Attack");
  doc.memo.push(["BASIS", basisLine(n.name)]);
  if (persp && persp !== home) doc.memo.push(["PERSPECTIVE", `Relations and threats assessed from the position of ${persp.name}.`]);
  const size = a.strength >= 75 ? "a major power" : a.strength >= 50 ? "a significant regional power" : a.strength >= 25 ? "a minor power" : "a marginal actor";
  const mom = X.gA > 0.04 ? "gaining strength" : X.gA < -0.04 ? "losing strength" : "broadly stable";
  H(doc, "1. Bottom line up front");
  Pp(doc, `${n.name} is ${size} (ranked ${rank} of ${nations.length}) and is ${mom}. ${persp && persp !== n ? `Its posture toward ${persp.name} is ${STANCE[a.stance].label.toLowerCase()}${a.reasons.length ? ` (${a.reasons.slice(0, 2).join("; ")})` : ""}. ` : ""}`
    + `The most likely course of action is that ${X.likely.text.charAt(0).toLowerCase() + X.likely.text.slice(1)}`
    + (X.dangerous && X.dangerous !== X.likely ? ` The most dangerous course for ${persp?.name || "the Kingdom"}: ${X.dangerous.text.charAt(0).toLowerCase() + X.dangerous.text.slice(1)}` : "")
    + ` Overall risk to ${n.name} itself is ${riskLevel(a.risk).label.toLowerCase()} (${a.risk}/100).`);
  H(doc, "2. Key judgments");
  doc.sections.push({ type:"kj", items:[
    ...X.coas.filter(x => x.key !== "status" || X.coas.length === 1).slice(0, 3).map(x => ({ text:x.text, likelihood:x.likelihood, conf:x.conf })),
    { text:`${n.name}'s risk of losing towns or land in the next 30 days is ${riskLevel(a.risk).label.toLowerCase()} (${a.risk}/100).`, likelihood:"", conf:X.conf },
  ] });
  H(doc, "3. Situation");
  const leader = !n.king ? "Leadership not reported by the API." : n.kingLast == null ? `Leader: ${n.king} (last login not checked).` : `Leader: ${n.king}, last online ${fmtDur(Date.now() - n.kingLast)} ago${X.leaderLeft != null && X.leaderLeft < 14 ? `; succession expected ${X.leaderLeft <= 0 ? "at the next purge" : "around " + fmtDay(Date.now() + X.leaderLeft * DAY)}` : ""}.`;
  B(doc, [
    `Strength: ${townsN(n.towns.length)}, ${n.residents} residents, ${n.active30} active in the last 30 days (${n.active7} in the last 7), ${n.chunks.toLocaleString()} chunks, ${gold(goldOf(n))} in banks.`,
    c ? `Disposition: territory centred near X ${Math.round(c.x)}, Z ${Math.round(c.z)}${cap ? `; capital ${cap.name}` : ""}${pc ? `; about ${Math.round(Math.hypot(c.x - pc.x, c.z - pc.z)).toLocaleString()} blocks ${bearingName(c.x - pc.x, c.z - pc.z)} of ${persp.name}` : ""}${a.contact && persp ? `, with ${townsN(a.contact)} within ${CONTACT_RANGE.toLocaleString()} blocks of its towns` : ""}.` : null,
    leader,
    `Alliances: ${n.allies.length ? n.allies.join(", ") : "none"}. Enemies: ${n.enemies.length ? n.enemies.join(", ") : "none"}.`,
  ]);
  doc.sections.push({ type:"table", cols:[{ h:"Measure", w:3 }, { h:"Now", w:1.2, align:"right" }, { h:"24 hours", w:1.1, align:"right" }, { h:"7 days", w:1.1, align:"right" }, { h:"30 days", w:1.1, align:"right" }, { h:"Trend", w:1.4 }],
    rows:[["Active members (30d)", "a30", n.active30], ["Residents", "res", n.residents], ["Towns", "towns", n.towns.length], ["Chunks", "chunks", n.chunks], ["Gold", "gold", goldOf(n)]].map(([l, k, v]) => {
      const t = trend(n.name, k); return [l, k === "gold" ? short(v) : Math.round(v).toLocaleString(), signed(t?.d24), signed(t?.d7), signed(t?.d30), trendWord(t)]; }) });
  H(doc, "4. Recent activity (7 days)");
  const ev = eventsFor(n.name, 7).slice(-14).reverse();
  if (ev.length) B(doc, ev.map(e => `${fmtDay(e.at)} — ${eventText(e, n.name)}`));
  else Pp(doc, ARCHIVE.scans > 1 ? "No significant changes recorded in the period." : "The archive has no earlier scan to compare against yet; activity will be logged from the next collection.");
  H(doc, "5. Capabilities");
  const allyActive = n.allies.map(x => findNation(x)?.active30 || 0).reduce((s, v) => s + v, 0);
  B(doc, [
    `Manpower: ${n.active30} active members; ${a.activeRate != null ? Math.round(a.activeRate * 100) + "% of checked members active in 30 days" : "activity rate unknown"}.`,
    `Economy: ${gold(goldOf(n))} in banks, ${gold(goldOf(n) / Math.max(1, n.towns.length))} per town.`,
    `Territory: ${n.chunks.toLocaleString()} chunks across ${townsN(n.towns.length)}.`,
    `Alliance network: ${n.allies.length} allies with ${allyActive} active members between them.`,
    `Overall strength score ${a.strength}/100 (rank ${rank} of ${nations.length}).`,
  ]);
  doc.sections.push({ type:"chart", title:`Active members (30-day), ${n.name}${persp && persp !== n ? " vs " + persp.name : ""}`, series:[{ name:n.name, color:[17, 17, 17], pts:seriesPts(n.name, "a30") }, ...(persp && persp !== n ? [{ name:persp.name, color:[196, 36, 78], pts:seriesPts(persp.name, "a30") }] : [])] });
  H(doc, "6. Intentions and anticipated courses of action");
  Pp(doc, `Most likely: ${X.likely.text} (${X.likely.likelihood}, ${X.likely.conf} confidence).`);
  if (X.dangerous) Pp(doc, `Most dangerous${persp ? ` to ${persp.name}` : ""}: ${X.dangerous.text} (${X.dangerous.likelihood}, ${X.dangerous.conf} confidence).`);
  const others = X.coas.filter(x => x !== X.likely && x !== X.dangerous && x.key !== "status");
  if (others.length) B(doc, others.map(x => `${x.text.replace(/\.$/, "")} — ${x.likelihood}.`));
  H(doc, "7. Vulnerabilities");
  const over = n.towns.filter(isOverclaimable), take = over.reduce((s, t) => s + overclaim(t).takeable, 0);
  const vulns = [
    X.ruin7.length ? `${townsN(X.ruin7.length)} forecast to ruin within 7 days: ${X.ruin7.slice(0, 6).map(t => `${t.name} (${fmtDay(Date.now() + etaOf(t))})`).join(", ")}${X.ruin7.length > 6 ? ", and others" : ""}.` : null,
    over.length ? `${chunks(take)} overclaimable now across ${townsN(over.length)}${over.length <= 5 ? ": " + over.map(t => t.name).join(", ") : ""}.` : null,
    a.leaderGone ? "The leader is past the inactivity limit." : null,
    a.activeRate != null && a.activeRate < 0.45 ? `Low cohesion: only ${Math.round(a.activeRate * 100)}% of members active.` : null,
  ].filter(Boolean);
  B(doc, vulns.length ? vulns : ["No significant vulnerabilities identified."]);
  H(doc, "8. Indicators to watch");
  B(doc, [
    `Active membership falling below ${Math.max(0, Math.round(n.active30 * 0.85))} (now ${n.active30}) would signal accelerating decline.`,
    X.exp ? `Further claims to the ${X.exp.dir}${X.exp.toward ? ` near ${X.exp.toward.name}` : ""} would confirm the expansion axis.` : `New towns or land claims would indicate a shift from consolidation to expansion.`,
    n.king && X.leaderLeft != null ? `A login by ${n.king} before ${fmtDay(Date.now() + Math.max(0, X.leaderLeft) * DAY)} would stop the succession.` : null,
    `New enemy declarations, or a sharp rise in treasury and activity together, would indicate preparation for hostile action.`,
  ]);
  H(doc, "9. Outlook");
  const proj = (t, cur) => t?.slope != null ? Math.max(0, Math.round(cur + t.slope * 7)) : null;
  doc.sections.push({ type:"table", cols:[{ h:"Projection (7 days)", w:3 }, { h:"Now", w:1, align:"right" }, { h:"Projected", w:1.2, align:"right" }, { h:"Basis", w:2.6 }],
    rows:[["Active members (30d)", n.active30, proj(X.tA, n.active30) ?? "—", X.tA?.slope != null ? `${signed(X.tA.slope)} a day` : "insufficient history"],
      ["Chunks", n.chunks, proj(X.tC, n.chunks) ?? "—", X.tC?.slope != null ? `${signed(X.tC.slope)} a day` : "insufficient history"],
      ["Towns", n.towns.length, Math.max(0, n.towns.length - X.ruin7.length + (X.tT?.slope > 0 ? Math.round(X.tT.slope * 7) : 0)), `${X.ruin7.length} forecast ruins`]] });
  if (!releasable) {
    H(doc, "10. Recommendations (Kingdom only)");
    const recs = [];
    if (over.length && a.stance !== "ally" && a.stance !== "home") recs.push(`Ministry of Attack: ${chunks(take)} can be taken from ${over.slice(0, 4).map(t => t.name).join(", ")} with /t takeoverclaim.`);
    if (X.ruin7.length && a.stance !== "ally" && a.stance !== "home") recs.push(`Ministry of Attack: position raiders for ${X.ruin7.slice(0, 3).map(t => `${t.name} (${fmtDay(Date.now() + etaOf(t))})`).join(", ")}.`);
    if (["ally", "friendly"].includes(a.stance) && (X.ruin7.length || a.risk >= 45)) recs.push(`Diplomacy: issue ${n.name} a Support Assessment; ${X.ruin7.length ? townsN(X.ruin7.length) + " need attention this week" : "its risk is elevated"}.`);
    if (X.dangerous) recs.push(`Defence: monitor the indicators above; ${X.dangerous.key === "encroach" ? "reinforce border towns facing " + n.name : "prepare a response if " + X.dangerous.key + " indicators trigger"}.`);
    const cand = X.coas.find(x => x.key === "realign"); if (cand && a.stance === "hostile") recs.push(`Diplomacy: ${cand.text.replace(/\.$/, "")}; consider approaching that nation first.`);
    B(doc, recs.length ? recs : ["No action required at this time; continue routine collection."]);
  }
  doc.sections.push({ type:"note", text:ESTIMATIVE_NOTE });
  return doc;
}

// ---- Support Assessment: written for an ally ----
function supportAssessment(n, releasable) {
  const a = assess(n, n.name), X = anticipate(n, n), threats = threatsTo(n).slice(0, 6);
  const doc = docBase("support", "SUP-" + codeOf(n.name), releasable, "SUPPORT ASSESSMENT", `${n.name.toUpperCase()} — RISKS, THREATS AND RECOMMENDED ACTIONS`, n.name.toUpperCase(),
    releasable ? `The Government of ${n.name}` : `The Crown Council; for onward release to ${n.name}`);
  doc.memo.push(["BASIS", basisLine(n.name)]);
  const lowAct = n.towns.filter(t => !t.ruined && t.count >= 2 && t.checked >= t.count && t.active / t.count < 0.34);
  const over = n.towns.filter(isOverclaimable), soonOver = n.towns.filter(t => isOverTarget(t) && !isOverclaimable(t));
  H(doc, "1. Bottom line up front");
  Pp(doc, `${n.name}'s overall risk is ${riskLevel(a.risk).label.toLowerCase()} (${a.risk}/100). ${threats.length ? `The principal threat${threats.length > 1 ? "s are" : " is"} ${threats.slice(0, 2).map(t => t.n.name).join(" and ")}.` : "No hostile nation currently presents a direct threat."} `
    + `${X.ruin7.length + over.length ? `${townsN(X.ruin7.length + over.length)} need attention within the next 7 days.` : "No towns are in immediate danger."} ${X.leaderLeft != null && X.leaderLeft < 14 ? `Leadership continuity is at risk: ${n.king} must log in within ${Math.max(0, Math.ceil(X.leaderLeft))} days.` : ""}`);
  H(doc, "2. Key judgments");
  doc.sections.push({ type:"kj", items:[
    { text:X.ruin7.length ? `${townsN(X.ruin7.length)} will fall to ruin within 7 days unless a resident logs in.` : `No towns will fall to ruin within 7 days on current activity.`, likelihood:X.ruin7.length ? "highly likely" : "likely", conf:"high" },
    ...(threats[0] ? [{ text:`${threats[0].n.name} poses the greatest threat to ${n.name} (hostility ${threats[0].a.hostility}/100, strength ${threats[0].a.strength}/100${threats[0].a.contact ? `, ${townsN(threats[0].a.contact)} nearby` : ""}).`, likelihood:"", conf:dataConfidence(threats[0].n.name) }] : []),
    { text:`${n.name}'s strength is ${X.gA > 0.04 ? "rising" : X.gA < -0.04 ? "falling" : "stable"} (${signed(anyDelta(X.tA))} active members in the period).`, likelihood:"", conf:X.conf },
  ] });
  H(doc, "3. Risk profile");
  doc.sections.push({ type:"table", cols:[{ h:"Factor", w:3 }, { h:"Value", w:2.2 }, { h:"Rating", w:1.2 }],
    rows:[["Towns forecast to ruin (7 days)", String(X.ruin7.length), X.ruin7.length ? "Serious" : "Low"],
      ["Land overclaimable now", chunks(over.reduce((s, t) => s + overclaim(t).takeable, 0)), over.length ? "Serious" : "Low"],
      ["Towns going over their claim limit soon", String(soonOver.length), soonOver.length ? "Elevated" : "Low"],
      ["Members active (30 days)", a.activeRate != null ? Math.round(a.activeRate * 100) + "%" : "unknown", a.activeRate < 0.4 ? "Serious" : a.activeRate < 0.6 ? "Elevated" : "Low"],
      ["Leader", n.king ? (a.leaderGone ? "past the inactivity limit" : n.kingLast ? `online ${fmtDur(Date.now() - n.kingLast)} ago` : "unknown") : "unknown", a.leaderGone ? "Serious" : X.leaderLeft != null && X.leaderLeft < 14 ? "Elevated" : "Low"],
      ["Gold per town", gold(goldOf(n) / Math.max(1, n.towns.length)), "—"],
      ["Overall risk score", `${a.risk} / 100`, riskLevel(a.risk).label]] });
  H(doc, "4. Threat assessment");
  if (threats.length) {
    doc.sections.push({ type:"table", cols:[{ h:"Nation", w:2.4 }, { h:"Stance", w:1.2 }, { h:"Strength", w:1, align:"right" }, { h:"Hostility", w:1, align:"right" }, { h:"Towns nearby", w:1.2, align:"right" }, { h:"Active (period)", w:1.3, align:"right" }],
      rows:threats.map(t => [t.n.name, STANCE[t.a.stance].label, t.a.strength, t.a.hostility, t.a.contact, signed(t.tA)]) });
    Pp(doc, threats[0].a.reasons.length ? `${threats[0].n.name} is assessed as the leading threat because it is ${threats[0].a.reasons.slice(0, 3).join(", ")}.` : "");
  } else Pp(doc, "No nation currently shows hostile indicators toward " + n.name + ".");
  H(doc, "5. Holdings at risk");
  const rows = [
    ...X.ruin7.map(t => [t.name, `Ruins ~${fmtDay(Date.now() + etaOf(t))}`, t.mayor, `Any resident logs in before ${fmtDay(Date.now() + etaOf(t))}`]),
    ...over.map(t => [t.name, `${chunks(overclaim(t).takeable)} overclaimable`, t.mayor, `Recruit ${Math.ceil(overclaim(t).takeable / perRes())} active residents, or unclaim edge chunks`]),
    ...lowAct.filter(t => !X.ruin7.includes(t)).slice(0, 6).map(t => [t.name, `${t.active}/${t.count} residents active`, t.mayor, "Re-engage inactive residents"]),
  ];
  if (rows.length) doc.sections.push({ type:"table", cols:[{ h:"Town", w:1.8 }, { h:"Issue", w:2 }, { h:"Mayor", w:1.4 }, { h:"Action needed", w:3.2 }], rows:rows.slice(0, 24) });
  else Pp(doc, "No individual towns are at immediate risk.");
  doc.sections.push({ type:"chart", title:`Active members (30-day), ${n.name}`, series:[{ name:n.name, color:[17, 17, 17], pts:seriesPts(n.name, "a30") }] });
  H(doc, "6. Outlook (7 days)");
  Pp(doc, `${X.likely.text} (${X.likely.likelihood}). ${X.tA?.slope != null ? `On current trends active membership will be about ${Math.max(0, Math.round(n.active30 + X.tA.slope * 7))} in 7 days.` : ""}`);
  H(doc, "7. Recommended actions");
  const recs = [];
  for (const t of X.ruin7.slice(0, 5)) recs.push(`${t.name}: the mayor (${t.mayor}) or any resident must log in before ${fmtDay(Date.now() + etaOf(t))}; otherwise the town falls to ruin and can be looted.`);
  for (const t of over.slice(0, 5)) recs.push(`${t.name}: ${chunks(overclaim(t).takeable)} can be taken by neighbours. Recruit about ${Math.ceil(overclaim(t).takeable / perRes())} active residents or release edge chunks you don't need.`);
  if (a.leaderGone || (X.leaderLeft != null && X.leaderLeft < 7)) recs.push(`Leadership: ${n.king} should log in, or the nation should prepare an orderly succession to an active member.`);
  if (threats[0]) {
    const shared = nations.filter(m => m !== n && m.enemies.includes(threats[0].n.name) && !n.allies.includes(m.name)).slice(0, 2);
    recs.push(`Defence: watch ${threats[0].n.name}'s border towns${shared.length ? `; ${shared.map(m => m.name).join(" and ")} share this enemy and may be natural partners` : ""}.`);
  }
  if (a.activeRate != null && a.activeRate < 0.5) recs.push("Cohesion: run a recruitment and re-engagement drive; inactive residents no longer count toward claim limits.");
  recs.push("The Kingdom of The Bleeding Heart will continue to monitor and will share warnings of hostile movements as they are detected.");
  B(doc, recs);
  doc.sections.push({ type:"note", text:ESTIMATIVE_NOTE });
  doc.distribution = releasable ? `Prepared by the Kingdom of The Bleeding Heart for the Government of ${n.name}. Releasable to ${n.name} and its allies.` : doc.distribution;
  return doc;
}

// ---- Daily Intelligence Summary ----
function intsum(releasable) {
  const home = findNation($("myNation").value), map = assessAll();
  const doc = docBase("intsum", "SUM", releasable, "DAILY INTELLIGENCE SUMMARY", `INTSUM — TERRA NOSTRA, ${new Date().toUTCString().slice(5, 16).toUpperCase()}`, "INTSUM",
    releasable ? "Allied governments of the Kingdom of The Bleeding Heart" : "The Crown Council; Ministry of Attack");
  doc.memo.push(["BASIS", basisLine(null)]);
  const ev24 = ARCHIVE.events.filter(e => e.at >= Date.now() - DAY), ev7 = ARCHIVE.events.filter(e => e.at >= Date.now() - 7 * DAY);
  const threats = home ? threatsTo(home).slice(0, 8) : [];
  const ruin72 = towns.filter(t => !t.ruined && !isProtected(t) && etaOf(t) != null && etaOf(t) < 3 * DAY).sort((a, b) => etaOf(a) - etaOf(b));
  const critical = nations.filter(n => map.get(n.name).risk >= 65 && n !== home);
  const movers = nations.map(n => ({ n, d:anyDelta(trend(n.name, "a30")) })).filter(x => x.d);
  const rising = movers.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5), falling = movers.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
  H(doc, "1. Bottom line up front");
  const headlines = [
    threats[0] ? `${threats[0].n.name} remains the leading threat to the Kingdom (hostility ${threats[0].a.hostility}, strength ${threats[0].a.strength}).` : null,
    ev24.filter(e => e.type === "town_ruin").length ? `${townsN(ev24.filter(e => e.type === "town_ruin").length)} fell to ruin in the last 24 hours.` : null,
    ruin72.length ? `${townsN(ruin72.length)} ${ruin72.length === 1 ? "is" : "are"} forecast to ruin within 72 hours.` : null,
    ev7.filter(e => /ally_add|enemy_add/.test(e.type)).length ? `${ev7.filter(e => /ally_add|enemy_add/.test(e.type)).length} alliance or enmity declarations this week signal diplomatic movement.` : null,
    critical.length ? `${critical.length} nation${critical.length > 1 ? "s are" : " is"} at critical risk: ${critical.slice(0, 3).map(n => n.name).join(", ")}.` : null,
  ].filter(Boolean);
  Pp(doc, headlines.join(" ") || "A quiet period: no significant changes were recorded.");
  H(doc, "2. Significant activity (last 24 hours)");
  const groups = {};
  for (const e of ev24) (groups[e.type] ||= []).push(e);
  const label = { town_ruin:"Towns ruined", town_gone:"Towns deleted", town_new:"Towns founded", town_switch:"Towns changing nation", land:"Major land changes", ally_add:"New alliances", ally_drop:"Alliances ended", enemy_add:"Enemies declared", enemy_drop:"Enmities ended", leader_change:"Leadership changes", nation_new:"Nations founded", nation_gone:"Nations dissolved", capital_change:"Capitals moved" };
  const lines = Object.entries(groups).filter(([k]) => label[k]).map(([k, es]) => `${label[k]} (${es.length}): ${es.slice(0, 5).map(e => k.startsWith("ally") || k.startsWith("enemy") ? `${e.ns[0]} – ${e.who}` : k === "town_switch" ? `${e.town} (${e.from} to ${e.to})` : k === "land" ? `${e.town} ${signed(e.d)}` : e.town || e.ns?.[0]).join(", ")}${es.length > 5 ? ", …" : ""}`);
  if (lines.length) B(doc, lines); else Pp(doc, ARCHIVE.scans > 1 ? "No significant changes recorded in the last 24 hours." : "This is the first collection; activity will be logged from the next scan.");
  H(doc, "3. Threat board");
  if (threats.length) doc.sections.push({ type:"table", cols:[{ h:"Nation", w:2.3 }, { h:"Stance", w:1.1 }, { h:"Strength", w:1, align:"right" }, { h:"Hostility", w:1, align:"right" }, { h:"Nearby", w:.9, align:"right" }, { h:"Active (period)", w:1.2, align:"right" }, { h:"Assessment", w:2 }],
    rows:threats.map(t => [t.n.name, STANCE[t.a.stance].label, t.a.strength, t.a.hostility, t.a.contact, signed(t.tA), t.a.flags.join(", ") || anticipate(t.n, home).likely.key])});
  else Pp(doc, "No nation currently shows hostile indicators toward the Kingdom.");
  if (!releasable) {
    H(doc, "4. Opportunities (Kingdom only)");
    const opp = [...towns.filter(t => isSoon(t) && t.nation !== home?.name).slice(0, 6).map(t => [t.name, t.nation || "—", "Ruin raid", stateOf(t).text, t.balance != null ? gold(t.balance) : "—"]),
      ...towns.filter(t => isOverclaimable(t) && t.nation !== home?.name && !["ally", "friendly"].includes(map.get(t.nation)?.stance)).sort((a, b) => overclaim(b).takeable - overclaim(a).takeable).slice(0, 6).map(t => [t.name, t.nation || "—", "Overclaim", chunks(overclaim(t).takeable), t.balance != null ? gold(t.balance) : "—"])];
    if (opp.length) doc.sections.push({ type:"table", cols:[{ h:"Town", w:1.8 }, { h:"Nation", w:1.6 }, { h:"Type", w:1.2 }, { h:"When / size", w:2 }, { h:"Bank", w:1, align:"right" }], rows:opp });
    else Pp(doc, "No immediate opportunities.");
  }
  H(doc, `${releasable ? 4 : 5}. Rising and declining powers`);
  B(doc, [rising.length ? `Rising: ${rising.map(x => `${x.n.name} (${signed(x.d)} active)`).join(", ")}.` : null, falling.length ? `Declining: ${falling.map(x => `${x.n.name} (${signed(x.d)} active)`).join(", ")}.` : null, !movers.length ? "Trends need at least two collections." : null]);
  H(doc, `${releasable ? 5 : 6}. Diplomatic movements (7 days)`);
  const dip = ev7.filter(e => /ally_|enemy_/.test(e.type));
  if (dip.length) B(doc, dip.slice(-12).reverse().map(e => `${fmtDay(e.at)} — ${eventText(e, null)}`)); else Pp(doc, "No changes to alliances or enmities recorded.");
  H(doc, `${releasable ? 6 : 7}. Forecast — next 72 hours`);
  const vac = nations.filter(n => n.kingLast != null && days() - (Date.now() - n.kingLast) / DAY < 3);
  B(doc, [
    ruin72.length ? `${townsN(ruin72.length)} forecast to ruin: ${ruin72.slice(0, 8).map(t => `${t.name}${t.nation ? ` (${t.nation})` : ""} ~${fmtDay(Date.now() + Math.max(0, etaOf(t)))}`).join(", ")}${ruin72.length > 8 ? ", …" : ""}.` : "No towns forecast to ruin.",
    vac.length ? `Leadership vacuums expected in ${vac.map(n => n.name).join(", ")}.` : null,
    critical.length ? `Critical risk: ${critical.slice(0, 6).map(n => `${n.name} (${map.get(n.name).risk})`).join(", ")}.` : null,
  ]);
  if (home) {
    H(doc, `${releasable ? 7 : 8}. The Kingdom`);
    const ha = map.get(home.name), ht = trend(home.name, "a30");
    Pp(doc, `${home.name}: ${townsN(home.towns.length)}, ${home.active30} active members (${signed(anyDelta(ht))} in the period), ${home.chunks.toLocaleString()} chunks. Strength ${ha.strength}/100, risk ${ha.risk}/100 (${riskLevel(ha.risk).label.toLowerCase()}). ${threats.filter(t => t.a.contact).length} hostile nation${threats.filter(t => t.a.contact).length === 1 ? "" : "s"} border Kingdom towns.`);
  }
  doc.sections.push({ type:"note", text:ESTIMATIVE_NOTE });
  return doc;
}

// ---- on-screen rendering (mirrors the PDF) ----
function docHtml(doc) {
  const crest = document.querySelector(".crest img")?.src || "";
  const sec = s => {
    if (s.type === "h") return `<h4>${esc(s.text)}</h4>`;
    if (s.type === "p") return `<p>${esc(s.text)}</p>`;
    if (s.type === "bullets") return `<ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
    if (s.type === "note") return `<p class="d-note">${esc(s.text)}</p>`;
    if (s.type === "kj") return `<ol class="d-kj">${s.items.map(i => `<li>${esc(i.text)}<small>${i.likelihood ? esc(i.likelihood) + " · " : ""}${esc(i.conf || "moderate")} confidence</small></li>`).join("")}</ol>`;
    if (s.type === "table") return `<div class="d-tw"><table class="d-t"><tr>${s.cols.map(c => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.h)}</th>`).join("")}</tr>${s.rows.map(r => `<tr>${r.map((v, i) => `<td class="${s.cols[i].align === "right" ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</table></div>`;
    if (s.type === "chart") {
      const all = s.series.flatMap(x => x.pts);
      if (all.length < 2) return `<div class="d-chart"><b>${esc(s.title)}</b><p class="d-note">Not enough history yet: trends appear after several collections.</p></div>`;
      let t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0])); if (t0 === t1) { t0 -= DAY; t1 += DAY; }
      const vmax = Math.max(1, ...all.map(p => p[1])), X = t => 40 + (t - t0) / (t1 - t0) * 540, Y = v => 110 - v / vmax * 100;
      return `<div class="d-chart"><b>${esc(s.title)}</b><svg viewBox="0 0 600 130"><line x1="40" y1="110" x2="580" y2="110" stroke="#ccc"/><text x="34" y="14" text-anchor="end" font-size="9" fill="#777">${short(vmax)}</text><text x="34" y="110" text-anchor="end" font-size="9" fill="#777">0</text>
        ${s.series.map(se => `<polyline fill="none" stroke="rgb(${se.color.join(",")})" stroke-width="1.6" points="${se.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`).join("")}
        <text x="40" y="126" font-size="9" fill="#777">${fmtDay(t0)}</text><text x="580" y="126" font-size="9" fill="#777" text-anchor="end">${fmtDay(t1)}</text></svg>
        <div class="d-leg">${s.series.map(se => `<span style="--c:rgb(${se.color.join(",")})">${esc(se.name)}</span>`).join("")}</div></div>`;
    }
    return "";
  };
  return `<article class="paper ${doc.releasable ? "rel" : ""}">
    <div class="d-band">${esc(doc.classification)}</div>
    <header class="d-head"><img src="${crest}" alt=""><div><b>KINGDOM OF THE BLEEDING HEART</b><small>${esc(doc.office)}</small><em>${esc(doc.docTitle)}</em></div>
      <dl><dt>Document no.</dt><dd>${esc(doc.id)}</dd><dt>Date-time group</dt><dd>${esc(doc.dtg)}</dd></dl></header>
    <dl class="d-memo">${doc.memo.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${k === "SUBJECT" ? "subj" : ""}">${esc(v)}</dd>`).join("")}</dl>
    ${doc.sections.map(sec).join("")}
    <div class="d-sign"><span></span><b>${esc(doc.signer)}</b><small>Ministry of Intelligence, Kingdom of The Bleeding Heart</small><i>DISTRIBUTION</i><p>${esc(doc.distribution)}</p></div>
    <div class="d-band">${esc(doc.classification)}</div>
  </article>`;
}
function docText(doc) {
  const out = [doc.classification, "", "KINGDOM OF THE BLEEDING HEART — " + doc.office, doc.docTitle, `${doc.id} · ${doc.dtg}`, "", ...doc.memo.map(([k, v]) => `${k}: ${v}`), ""];
  for (const s of doc.sections) {
    if (s.type === "h") out.push("", s.text.toUpperCase());
    else if (s.type === "p" || s.type === "note") out.push(s.text);
    else if (s.type === "bullets") s.items.forEach(i => out.push("• " + i));
    else if (s.type === "kj") s.items.forEach((i, k) => out.push(`${k + 1}. ${i.text} [${i.likelihood ? i.likelihood + ", " : ""}${i.conf} confidence]`));
    else if (s.type === "table") { out.push(s.cols.map(c => c.h).join(" | ")); s.rows.forEach(r => out.push(r.join(" | "))); }
  }
  out.push("", doc.signer, "Ministry of Intelligence, Kingdom of The Bleeding Heart", "Distribution: " + doc.distribution, "", doc.classification);
  return out.join("\n");
}
function downloadPdf(doc) {
  const bytes = briefingPdf(doc), blob = new Blob([bytes], { type:"application/pdf" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${doc.id}.pdf`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return bytes;
}
