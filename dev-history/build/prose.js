// ---- writing helpers: reports are numbered prose paragraphs; tables and charts go in annexes ----
const andList = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const nf = v => v == null || isNaN(v) ? "an unknown number of" : Math.round(v).toLocaleString();
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
// small counts are written as words, as a person would write them
const NUM_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = k => Number.isInteger(k) && k >= 0 && k <= 10 ? NUM_WORDS[k] : nf(k);
const plural = (k, w, ws) => `${count(k)} ${k === 1 ? w : (ws || w + "s")}`;
const moved = (v, unit = "") => v == null ? "not yet been measured" : v > 0 ? `risen by ${nf(v)}${unit}` : v < 0 ? `fallen by ${nf(-v)}${unit}` : "held steady";
const proseDur = ms => { const d = ms / DAY, h = ms / 36e5; return d >= 1.5 ? `${Math.round(d)} days` : d >= 1 ? "a day" : h >= 1.5 ? `${Math.round(h)} hours` : "under an hour"; };
// assessment reasons are written from "our" side; restate them for another nation's point of view
const reasonsAs = (a, who) => who ? a.reasons.map(r => r.replace(/\bours\b/g, who).replace(/\bour\b/g, who + "'s").replace(/\bus\b/g, who)) : a.reasons;
const Para = (doc, text, num = true) => { if (text && text.trim()) doc.sections.push({ type:"p", num,
  text:text.replace(/\s+/g, " ").trim().replace(/(^|[.?!:]\s+)(no|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (m, a, w) => a + cap1(w)) }); };
const Head = (doc, text) => doc.sections.push({ type:"h", text });
const Annex = (doc, text) => doc.sections.push({ type:"annex", text });
const ordinal = k => k + (["th", "st", "nd", "rd"][(k % 100 - 20) % 10] || ["th", "st", "nd", "rd"][k % 100] || "th");
const lcFirst = (t, keep) => keep && t.startsWith(keep) ? t : t.charAt(0).toLowerCase() + t.slice(1);
const stripDot = t => t.replace(/\.$/, "");
// a forecast's main clause, for use inside a longer sentence (its detail is given separately)
const clause = t => stripDot(t).split(/[;:]\s/)[0];
function arcOf(name, key) {
  const i = PT[key], pts = seriesOf(name).filter(p => p[i] != null); if (pts.length < 2) return null;
  let hi = pts[0], lo = pts[0]; for (const p of pts) { if (p[i] > hi[i]) hi = p; if (p[i] < lo[i]) lo = p; }
  return { f:pts[0][i], l:pts[pts.length - 1][i], t0:pts[0][0], hi:hi[i], thi:hi[0], lo:lo[i], tlo:lo[0] };
}
function arcSentence(name, key, noun, fmt = nf) {
  const a = arcOf(name, key); if (!a) return "";
  const ch = a.l - a.f, pc = a.f ? Math.round(Math.abs(ch) / a.f * 100) : 0;
  let s = `${cap1(noun)} stood at ${fmt(a.f)} when the archive first recorded ${name} on ${fmtDay(a.t0)} and now stands at ${fmt(a.l)}, ${ch === 0 ? "unchanged over the period" : `${ch > 0 ? "an increase" : "a decline"} of ${fmt(Math.abs(ch))}${pc ? ` (${pc} per cent)` : ""}`}.`;
  if (a.hi > Math.max(a.f, a.l)) s += ` It reached a high of ${fmt(a.hi)} on ${fmtDay(a.thi)}.`;
  if (a.lo < Math.min(a.f, a.l)) s += ` Its lowest recorded level was ${fmt(a.lo)} on ${fmtDay(a.tlo)}.`;
  return s;
}
function arcShort(name, key, noun, unit = "") {
  const a = arcOf(name, key); if (!a) return "";
  const ch = a.l - a.f, pc = a.f ? Math.round(Math.abs(ch) / a.f * 100) : 0;
  return ch === 0 ? `${noun} held at ${nf(a.l)}${unit}` : `${noun} went from ${nf(a.f)} to ${nf(a.l)}${unit}${pc ? ` (${ch > 0 ? "up" : "down"} ${pc} per cent)` : ""}`;
}
const medianOf = vals => { const s = [...vals].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const rankBy = (n, f) => [...nations].sort((a, b) => f(b) - f(a)).indexOf(n) + 1;
const townLine = t => `${t.name} (${plural(t.blocks || 0, "chunk")}, ${t.checked >= t.count ? `${t.active} of ${t.count} residents active` : `${plural(t.count, "resident")}`})`;
// why the Ministry holds a judgment, in a sentence or two
function reasonFor(x, n, X, persp) {
  const tA = anyDelta(X.tA), tC = anyDelta(X.tC), tR = anyDelta(X.tR);
  const r = {
    expand:`Over the period its territory has ${moved(tC, " chunks")} and its active membership has ${moved(tA)}${X.exp ? `; the ${X.exp.basis} lie predominantly to the ${X.exp.dir}${X.exp.toward ? `, in the direction of ${X.exp.toward.name}` : ""}` : ""}.`,
    contract:X.ruin7.length ? `${plural(X.ruin7.length, "town")} will pass the inactivity limit within seven days unless a resident logs in, and over the period active membership has ${moved(tA)}.` : `Although no town is yet close to ruin, active membership has ${moved(tA)} and territory has ${moved(tC, " chunks")} over the period, which points to weakening cohesion.`,
    succession:`${n.king} was last online ${proseDur(Date.now() - (n.kingLast || Date.now()))} ago; under the server's rules leadership passes to another member once the leader exceeds the inactivity limit.`,
    realign:"The nation shares several allies or enemies with a power it is not yet formally aligned with, and nations in that position tend to formalise the relationship.",
    hostile:`${X.newEnemies.length ? `It has declared ${plural(X.newEnemies.length, "new enemy", "new enemies")} in the last fortnight` : "Its active membership and treasury have risen sharply together"}, a pattern that usually precedes coordinated action.`,
    recruit:`Its resident count has ${moved(tR)} over the period, well above the server norm.`,
    encroach:`The distance between its towns and ${persp?.name || "ours"} has been falling steadily over the past week.`,
    status:"The indicators the Ministry tracks have moved little over the period, and no event has been recorded that would suggest a change of course.",
  }[x.key] || "";
  return r + (x.ml >= 0.3 ? ` The Forecast Lab model, which has been checked against ${nf(mlState().models[{ contract:"loss7", expand:"gain7", succession:"leader7", realign:"diplo7" }[x.key]]?.n || 0)} real outcomes, contributed to this estimate.` : "");
}
// shared annexes: statistics, trends and the town register
function addAnnexes(doc, n, persp) {
  Annex(doc, "Annex A — Statistical Summary");
  doc.sections.push({ type:"table", cols:[{ h:"Measure", w:3 }, { h:"Now", w:1.2, align:"right" }, { h:"24 hours", w:1.1, align:"right" }, { h:"7 days", w:1.1, align:"right" }, { h:"30 days", w:1.1, align:"right" }, { h:"Trend", w:1.4 }],
    rows:[["Active members (30 days)", "a30", n.active30], ["Active members (7 days)", "a7", n.active7], ["Residents", "res", n.residents], ["Towns", "towns", n.towns.filter(t => !t.ruined).length], ["Chunks", "chunks", n.chunks], ["Gold", "gold", goldOf(n)], ["Towns forecast to fall (3 days)", "falling", n.towns.filter(isSoon).length], ["Chunks overclaimable", "take", assess(n).take]].map(([l, k, v]) => {
      const t = trend(n.name, k); return [l, k === "gold" ? short(v) : nf(v), signed(t?.d24), signed(t?.d7), signed(t?.d30), trendWord(t)]; }) });
  Para(doc, "Changes are measured against the nearest archived collection at or before each interval. A dash means the archive does not yet reach back that far.", false);
  Annex(doc, "Annex B — Trends");
  doc.sections.push({ type:"chart", title:`Figure 1. Active members (30-day), ${n.name}${persp && persp !== n ? " and " + persp.name : ""}`, series:[{ name:n.name, color:[17, 17, 17], pts:seriesPts(n.name, "a30") }, ...(persp && persp !== n ? [{ name:persp.name, color:[196, 36, 78], pts:seriesPts(persp.name, "a30") }] : [])] });
  doc.sections.push({ type:"chart", title:`Figure 2. Territory in chunks, ${n.name}`, series:[{ name:n.name, color:[17, 17, 17], pts:seriesPts(n.name, "chunks") }] });
  doc.sections.push({ type:"chart", title:`Figure 3. Towns, ${n.name}`, series:[{ name:n.name, color:[17, 17, 17], pts:seriesPts(n.name, "towns") }] });
  Annex(doc, "Annex C — Register of Towns");
  const rows = [...n.towns].filter(t => !t.ruined).sort((a, b) => (b.blocks || 0) - (a.blocks || 0)).slice(0, 60).map(t => {
    const o = overclaim(t), st = isOverclaimable(t) ? `${o.takeable} overclaimable` : isProtected(t) ? "Protected" : isSoon(t) ? "Ruin " + fmtDay(Date.now() + Math.max(0, etaOf(t))) : "Stable";
    return [t.name + (t.name === n.capital ? " (capital)" : ""), t.mayor, t.checked >= t.count ? `${t.active}/${t.count}` : String(t.count), `${t.blocks ?? "?"}${o ? "/" + o.limit : ""}`, t.balance != null ? gold(t.balance) : "—", st];
  });
  doc.sections.push({ type:"table", cols:[{ h:"Town", w:2.4 }, { h:"Mayor", w:1.6 }, { h:"Active", w:.9, align:"right" }, { h:"Chunks", w:1, align:"right" }, { h:"Bank", w:1, align:"right" }, { h:"Status", w:1.8 }], rows });
  if (n.towns.filter(t => !t.ruined).length > 60) Para(doc, `The sixty largest of ${n.towns.filter(t => !t.ruined).length} towns are shown.`, false);
}

// ---- Intelligence Assessment ----
function nationAssessment(n, p, releasable) {
  const a = relTo(n, p), X = anticipate(n, p), home = findNation($("myNation").value), persp = p || home;
  const live = n.towns.filter(t => !t.ruined), cap = live.find(t => t.name === n.capital), c = centroid(live), pc = persp && persp !== n ? centroid(persp.towns) : null;
  const N = nations.length, rank = rankBy(n, x => assess(x).strength), rankA = rankBy(n, x => x.active30), rankG = rankBy(n, goldOf);
  const doc = docBase("nation", codeOf(n.name), releasable, "INTELLIGENCE ASSESSMENT", `${n.name.toUpperCase()}: CAPABILITIES, INTENTIONS AND OUTLOOK`, n.name.toUpperCase(),
    releasable ? "Allied governments of the Kingdom of The Bleeding Heart" : "The Crown Council; Ministry of Attack");
  doc.memo.push(["BASIS", basisLine(n.name)]);
  if (persp && persp !== home) doc.memo.push(["PERSPECTIVE", `Relations and threats are assessed from the position of ${persp.name}.`]);
  const size = a.strength >= 75 ? "a major power" : a.strength >= 50 ? "a significant regional power" : a.strength >= 25 ? "a minor power" : "a marginal actor";
  const mom = X.gA > 0.04 ? "is gaining strength" : X.gA < -0.04 ? "is losing strength" : "is broadly stable";
  const stanceWord = STANCE[a.stance].label.toLowerCase(), why = reasonsAs(a, persp && persp !== home ? persp.name : null);

  Head(doc, "Summary");
  Para(doc, `${n.name} is ${size}, ranked ${ordinal(rank)} of ${N} nations by overall strength and ${ordinal(rankA)} by active membership. It holds ${plural(live.length, "town")} with ${plural(n.residents, "resident")}, of whom ${nf(n.active30)} were active in the last thirty days, and controls ${plural(n.chunks, "chunk")} of territory with ${gold(goldOf(n))} held in its town banks. On the evidence of the archive it ${mom}: over the period under review its active membership has ${moved(anyDelta(X.tA))} and its territory has ${moved(anyDelta(X.tC), " chunks")}.`);
  Para(doc, `${persp && persp !== n ? `The Ministry assesses ${n.name}'s posture toward ${persp.name} as ${stanceWord}${why.length ? `, because it is ${andList(why.slice(0, 3))}` : ""}. ` : ""}The most likely development is that ${lcFirst(clause(X.likely.text), n.name)}, which the Ministry judges ${X.likely.likelihood}. ${X.dangerous && X.dangerous !== X.likely ? `The most dangerous development for ${persp?.name || "the Kingdom"} would be that ${lcFirst(clause(X.dangerous.text), n.name)}; this is judged ${X.dangerous.likelihood}. ` : ""}The risk that ${n.name} itself loses towns or territory in the next thirty days is assessed as ${riskLevel(a.risk).label.toLowerCase()}, with a score of ${a.risk} out of 100.`);

  Head(doc, "Key Judgments");
  const kjs = X.coas.filter(x => x.s >= 0.2 && (x.key !== "status" || X.coas.length === 1)).slice(0, 4);
  for (const x of kjs) Para(doc, `The Ministry judges it ${x.likelihood} (${x.conf} confidence) that ${lcFirst(clause(x.text), n.name)}. ${reasonFor(x, n, X, persp)}`);
  Para(doc, `The Ministry assesses with ${X.conf} confidence that ${n.name}'s risk of losing towns or land in the next thirty days is ${riskLevel(a.risk).label.toLowerCase()}. ${a.falling ? `${plural(a.falling, "town")} could fall within three days, ` : ""}${a.take ? `${plural(a.take, "chunk")} of its territory can already be overclaimed, ` : ""}and ${a.activeRate != null ? `${Math.round(a.activeRate * 100)} per cent of the members whose activity was checked have been online in the last month` : "member activity could not be fully checked"}.`);

  Head(doc, "Background and Recent History");
  Para(doc, `${n.registered ? `${n.name} was founded on ${new Date(n.registered).toLocaleDateString(undefined, { day:"numeric", month:"long", year:"numeric" })}. ` : ""}${arcSentence(n.name, "a30", "active membership") || `The archive holds too few collections on ${n.name} to describe its trajectory yet; this assessment rests mainly on the most recent scan.`} ${(sh => sh.length ? `Over the same period ${andList(sh)}.` : "")([arcShort(n.name, "chunks", "its territory", " chunks"), arcShort(n.name, "towns", "the number of its towns"), arcShort(n.name, "res", "its residents")].filter(Boolean))}`);
  const ev30 = eventsFor(n.name, 30), cnt = f => ev30.filter(f).length;
  const founded = cnt(e => e.type === "town_new" && e.ns[0] === n.name), lost = cnt(e => (e.type === "town_ruin" || e.type === "town_gone") && e.ns[0] === n.name);
  const gainedD = cnt(e => (e.type === "town_switch" || e.type === "town_join") && e.to === n.name), lostD = cnt(e => (e.type === "town_switch" || e.type === "town_leave") && e.from === n.name);
  const dipl = ev30.filter(e => /^(ally|enemy)_/.test(e.type) && e.ns[0] === n.name);
  Para(doc, ev30.length ? `Over the past thirty days the archive recorded ${plural(founded, "new town")} founded within ${n.name} and ${plural(lost, "town")} lost to ruin or deletion. ${gainedD || lostD ? `${plural(gainedD, "town")} joined from other nations while ${plural(lostD, "town")} left. ` : "No towns changed allegiance. "}${dipl.length ? `Its government made ${plural(dipl.length, "diplomatic change")} in the same period, most recently when it ${eventText(dipl[dipl.length - 1], n.name)} on ${fmtDay(dipl[dipl.length - 1].at)}.` : "Its alliances and enmities were unchanged."}`
    : ARCHIVE.scans > 1 ? `No significant changes to ${n.name}'s towns or diplomacy have been recorded in the past thirty days.` : `Activity is recorded by comparing successive collections; the archive will begin logging changes for ${n.name} from the next scan.`);

  Head(doc, "Leadership and Internal Cohesion");
  const capA = cap ? ` The capital, ${cap.name}, is a town of ${plural(cap.blocks || 0, "chunk")} ${cap.checked >= cap.count ? `with ${cap.active} of its ${cap.count} residents active` : `with ${plural(cap.count, "resident")}`}.` : "";
  Para(doc, !n.king ? `The API did not report ${n.name}'s leadership, so the Ministry cannot assess the stability of its government directly.${capA}` : n.kingLast == null ? `${n.name} is led by ${n.king}, whose recent activity was not checked in this collection.${capA}`
    : `${n.name} is led by ${n.king}, who was last online ${proseDur(Date.now() - n.kingLast)} ago. ${X.leaderLeft != null && X.leaderLeft <= 0 ? `This is beyond the ${days()}-day inactivity limit, and the Ministry expects leadership to pass to another member at the next daily purge, a transition that typically brings a period of uncertain direction.` : X.leaderLeft != null && X.leaderLeft < 14 ? `At this rate the leader will reach the inactivity limit around ${fmtDay(Date.now() + X.leaderLeft * DAY)}, after which leadership would pass to another member. A single login before then would reset the clock.` : "The leader is comfortably within the inactivity limit, and the Ministry sees no sign of an imminent change of government."}${capA}`);
  const dead = live.filter(t => t.count && t.checked >= t.count && t.active === 0), med = medianOf(nations.map(x => assess(x).activeRate ?? 0.5));
  Para(doc, `${a.activeRate != null ? `Of the members whose activity was checked, ${Math.round(a.activeRate * 100)} per cent have been online in the last thirty days, against a server median of ${Math.round(med * 100)} per cent; ${nf(n.active7)} were online in the last week alone. ` : ""}${dead.length ? `${plural(dead.length, "town")} ha${dead.length === 1 ? "s" : "ve"} no active residents at all${dead.length <= 5 ? `: ${andList(dead.map(t => t.name))}` : `, including ${andList(dead.slice(0, 4).map(t => t.name))}`}. ` : "Every town checked has at least one active resident. "}${live.filter(mayorReplaced).length ? `In ${plural(live.filter(mayorReplaced).length, "town")} the mayor has exceeded the inactivity limit and is being replaced by another resident.` : ""} Taken together, the Ministry assesses ${n.name}'s internal cohesion as ${a.activeRate == null ? "uncertain" : a.activeRate >= med + 0.1 ? "strong" : a.activeRate >= med - 0.1 ? "typical for the server" : "weak"}.`);

  Head(doc, "Territory and Disposition");
  const biggest = [...live].sort((x, y) => (y.blocks || 0) - (x.blocks || 0)).slice(0, 3);
  const spread = c ? Math.round(live.filter(t => t.c).reduce((s, t) => s + Math.hypot(t.c.x - c.x, t.c.z - c.z), 0) / Math.max(1, live.filter(t => t.c).length)) : null;
  Para(doc, c ? `${n.name}'s towns are centred near X ${nf(c.x)}, Z ${nf(c.z)}, and lie on average ${nf(spread)} blocks from that point, which makes it ${spread < 1500 ? "a compact nation that is comparatively easy to defend" : spread < 4000 ? "a moderately dispersed nation" : "a widely scattered nation whose outlying towns would be difficult to support"}. Its largest holdings are ${andList(biggest.map(townLine))}.${cap?.c ? ` The capital sits at X ${nf(cap.c.x)}, Z ${nf(cap.c.z)}.` : ""}` : `The positions of ${n.name}'s towns were not reported.`);
  if (pc && c) {
    const pTowns = persp.towns.filter(t => t.c && !t.ruined); let close = null;
    for (const t of live) if (t.c) for (const o of pTowns) { const d = Math.hypot(t.c.x - o.c.x, t.c.z - o.c.z); if (!close || d < close.d) close = { t, o, d }; }
    Para(doc, `The centre of ${n.name} lies about ${nf(Math.hypot(c.x - pc.x, c.z - pc.z))} blocks ${bearingName(c.x - pc.x, c.z - pc.z)} of ${persp.name}. ${a.contact ? `${plural(a.contact, "of its towns")} lie within ${nf(CONTACT_RANGE)} blocks of ${persp.name}'s` : `None of its towns lies within ${nf(CONTACT_RANGE)} blocks of ${persp.name}'s`}${close ? `; the closest pair are ${close.t.name} and ${close.o.name}, ${nf(close.d)} blocks apart` : ""}. ${X.tD?.slope != null && persp === home ? (X.tD.slope < -25 ? `That gap has been narrowing by about ${nf(-X.tD.slope)} blocks a day over the past week.` : X.tD.slope > 25 ? `The gap has been widening by about ${nf(X.tD.slope)} blocks a day.` : "The gap has been stable over the past week.") : ""}`);
  }
  const over = live.filter(isOverclaimable), take = over.reduce((s, t) => s + overclaim(t).takeable, 0), soonOver = live.filter(t => isOverTarget(t) && !isOverclaimable(t));
  Para(doc, `${X.exp ? `Over the past week the nation's territory has been shifting to the ${X.exp.dir}, judging by the ${X.exp.basis}${X.exp.toward ? `; the nearest nation in that direction is ${X.exp.toward.name}` : ""}. ` : "The archive shows no consistent direction of expansion over the past week. "}${over.length ? `${plural(over.length, "town")} currently claim${over.length === 1 ? "s" : ""} more land than ${over.length === 1 ? "its" : "their"} residents support, leaving ${plural(take, "chunk")} open to overclaim. ` : "None of its towns currently claims more land than its residents support. "}${soonOver.length ? `A further ${plural(soonOver.length, "town")} will exceed ${soonOver.length === 1 ? "its" : "their"} claim limit within ${ocWindow()} days as inactive residents stop counting.` : ""}`);

  Head(doc, "Economy");
  const rich = [...live].filter(t => t.balance != null).sort((x, y) => y.balance - x.balance), broke = rich.filter(t => t.balance < 10);
  Para(doc, `${n.name}'s town banks hold ${gold(n.townGold)} in total${n.nationGold != null ? `, and the national bank a further ${gold(n.nationGold)}` : ""}, which ranks ${ordinal(rankG)} of ${N}. That is ${gold(Math.round(goldOf(n) / Math.max(1, live.length)))} per town against a server median of ${gold(Math.round(medianOf(nations.map(x => goldOf(x) / Math.max(1, x.towns.length)))))}. ${rich.length ? `Wealth is concentrated in ${andList(rich.slice(0, 3).map(t => `${t.name} (${gold(t.balance)})`))}. ` : ""}${broke.length ? `${plural(broke.length, "town")} hold${broke.length === 1 ? "s" : ""} almost nothing and would struggle to pay daily upkeep. ` : ""}${arcSentence(n.name, "gold", "total gold", v => gold(Math.round(v)))}`);

  Head(doc, "Foreign Relations");
  const descr = name => { const m = findNation(name); if (!m) return name; const ma = assess(m, persp?.name); return `${name} (strength ${ma.strength}, ${m.active30} active members${persp && persp !== m ? `, ${STANCE[ma.stance].label.toLowerCase()} toward ${persp.name}` : ""})`; };
  Para(doc, n.allies.length ? `${n.name} is formally allied with ${plural(n.allies.length, "nation")}: ${andList(n.allies.map(descr))}. Together these allies command ${nf(n.allies.reduce((s, x) => s + (findNation(x)?.active30 || 0), 0))} active members.` : `${n.name} has no formal allies, which leaves it without guaranteed support if it is attacked.`);
  Para(doc, n.enemies.length ? `It has declared ${plural(n.enemies.length, "enemy", "enemies")}: ${andList(n.enemies.map(descr))}.` : `It has declared no enemies.`);
  if (persp && persp !== n) {
    const bloc = [n, ...n.allies.map(findNation).filter(Boolean)], pbloc = [persp, ...persp.allies.map(findNation).filter(Boolean)];
    Para(doc, `${why.length ? `From ${persp.name}'s position, the significant facts are that ${n.name} is ${andList(why)}. ` : `${n.name} has no direct or indirect ties to ${persp.name}. `}Measured by active members, ${n.name} and its allies field ${nf(bloc.reduce((s, x) => s + x.active30, 0))} against ${nf(pbloc.reduce((s, x) => s + x.active30, 0))} for ${persp.name} and its allies.`);
  }
  const partner = X.coas.find(x => x.key === "realign"), dip14 = eventsFor(n.name, 14).filter(e => /^(ally|enemy)_/.test(e.type));
  Para(doc, `${dip14.length ? `In the past fortnight ${n.name}'s diplomatic position has moved: ${andList(dip14.slice(-4).map(e => `on ${fmtDay(e.at)} it ${eventText(e, n.name)}`))}. ` : "Its diplomatic position has been static for at least a fortnight. "}${partner ? `${partner.text.replace(/\.$/, "")}; the Ministry judges this ${partner.likelihood}.` : ""}`);

  Head(doc, "Military Potential");
  const ratio = persp && persp !== n && persp.active30 ? n.active30 / persp.active30 : null;
  Para(doc, `In Towny warfare, active manpower determines how quickly a nation can claim, defend and contest land, and treasury determines whether it can sustain those claims. ${n.name} ranks ${ordinal(rankA)} of ${N} by active members and ${ordinal(rankG)} by gold. ${ratio != null ? `Its active membership is ${Math.round(ratio * 100)} per cent of ${persp.name}'s. ` : ""}${a.strength >= 70 ? "It has the capacity to mount sustained territorial operations." : a.strength >= 40 ? "It could conduct limited operations against a weaker neighbour but would struggle against a peer." : "It lacks the manpower to threaten a well-organised neighbour on its own."} Its overall strength score is ${a.strength} out of 100.`);

  Head(doc, "Vulnerabilities");
  Para(doc, X.ruin7.length ? `${plural(X.ruin7.length, "town")} will pass the inactivity limit within seven days unless one of their residents logs in: ${andList(X.ruin7.slice(0, 8).map(t => `${t.name} (mayor ${t.mayor}, around ${fmtDay(Date.now() + Math.max(0, etaOf(t)))})`))}${X.ruin7.length > 8 ? `, and ${X.ruin7.length - 8} others` : ""}. Once ruined, their contents can be taken by anyone.` : `No town of ${n.name} is forecast to fall to ruin within seven days.`);
  Para(doc, over.length ? `${plural(take, "chunk")} can be taken now by overclaim from ${andList(over.slice(0, 6).map(t => `${t.name} (${overclaim(t).takeable})`))}${over.length > 6 ? ` and ${over.length - 6} other towns` : ""}. Their homeblocks are protected, but the surplus can be claimed by any town over thirty days old that borders them.` : "", over.length > 0);
  Para(doc, `${a.leaderGone ? "The leader is past the inactivity limit, which leaves the nation's direction uncertain until a successor takes charge. " : ""}${a.activeRate != null && a.activeRate < 0.45 ? `Low activity is the nation's most serious structural weakness: fewer than half its members are active, and every inactive resident reduces the land its towns may hold.` : ""}`, a.leaderGone || (a.activeRate != null && a.activeRate < 0.45));

  Head(doc, "Outlook and Scenarios");
  const alt = X.coas.find(x => x !== X.likely && x !== X.dangerous && x.key !== "status");
  Para(doc, `The most likely scenario over the coming week is that ${lcFirst(clause(X.likely.text), n.name)} (${X.likely.likelihood}, ${X.likely.conf} confidence). ${reasonFor(X.likely, n, X, persp)} The Ministry would regard ${X.likely.key === "expand" ? "new towns or claims along the same axis" : X.likely.key === "contract" ? "further towns ruining or residents leaving" : X.likely.key === "succession" ? "the leader remaining offline past the limit" : "the continuation of current trends"} as confirmation.`);
  if (X.dangerous && X.dangerous !== X.likely) Para(doc, `The most dangerous scenario for ${persp?.name || "the Kingdom"} is that ${lcFirst(clause(X.dangerous.text), n.name)} (${X.dangerous.likelihood}). Early warning would come from new enemy declarations, a simultaneous rise in activity and treasury, or claims appearing close to ${persp?.name || "our"} towns.`);
  if (alt) Para(doc, `An alternative development is that ${lcFirst(clause(alt.text), n.name)} (${alt.likelihood}).`);
  const proj = (t, cur, d) => t?.slope != null ? Math.max(0, Math.round(cur + t.slope * d)) : null;
  Para(doc, X.tA?.slope != null ? `If current trends hold, ${n.name} will have about ${nf(proj(X.tA, n.active30, 7))} active members and ${nf(proj(X.tC, n.chunks, 7))} chunks in seven days, ${proj(X.tA, n.active30, 30) <= 2 ? "and would be left with almost no active members within thirty" : `and about ${nf(proj(X.tA, n.active30, 30))} active members in thirty`}. Thirty-day projections assume the past week's rate continues and should be treated with caution.` : `The archive does not yet hold a week of history on ${n.name}, so numerical projections are not offered.`);

  if (persp && persp !== n) {
    Head(doc, `Implications for ${persp === home ? "the Kingdom" : persp.name}`);
    const opp = (over.length || X.ruin7.length) && !["ally", "friendly", "home"].includes(a.stance);
    Para(doc, `${a.stance === "hostile" ? `${n.name} should be treated as an adversary.` : a.stance === "wary" ? `${n.name} is not an open enemy but its connections place it on the opposing side, and it should be watched.` : ["ally", "friendly"].includes(a.stance) ? `${n.name} is a partner whose stability matters to ${persp.name}.` : `${n.name} is neutral toward ${persp.name}.`} ${a.contact ? `Because ${plural(a.contact, "of its towns")} lie close to ${persp.name}'s, any change in its posture would be felt quickly along the border.` : "It does not border us directly, which limits its immediate impact."} ${opp ? `Its current weaknesses also present opportunities: ${X.ruin7.length ? `towns about to ruin can be raided` : ""}${X.ruin7.length && over.length ? " and " : ""}${over.length ? `surplus land can be overclaimed` : ""}.` : ""} ${["ally", "friendly"].includes(a.stance) && a.risk >= 45 ? `Its elevated risk means it may need support; a Support Assessment should be prepared for its government.` : ""}`);
  }

  if (!releasable) {
    Head(doc, "Recommendations");
    const recs = [];
    if (over.length && !["ally", "friendly", "home"].includes(a.stance)) recs.push(`The Ministry of Attack should prepare overclaim operations against ${andList(over.slice(0, 4).map(t => t.name))}, which together offer ${plural(take, "chunk")}; operations require a Kingdom town over thirty days old with three adjacent claims along the border.`);
    if (X.ruin7.length && !["ally", "friendly", "home"].includes(a.stance)) recs.push(`Raiding parties should be positioned for ${andList(X.ruin7.slice(0, 3).map(t => `${t.name} on ${fmtDay(Date.now() + Math.max(0, etaOf(t)))}`))}, using the nearest funded public warp listed in the Ruin Hunter.`);
    if (["ally", "friendly"].includes(a.stance) && (X.ruin7.length || a.risk >= 45)) recs.push(`The Crown should issue ${n.name} a Support Assessment, drawing attention to ${X.ruin7.length ? `the ${plural(X.ruin7.length, "town")} at risk this week` : "its elevated risk"}.`);
    if (X.dangerous) recs.push(`Border towns facing ${n.name} should be kept active and within their claim limits, and the indicators described under Outlook monitored at each collection.`);
    if (partner && a.stance === "hostile") recs.push(`Diplomatic contact should be made with the nation ${n.name} appears to be courting before an alignment is formalised.`);
    if (!recs.length) recs.push(`No action is required at present. Routine collection should continue so that any change in ${n.name}'s posture is detected early.`);
    recs.forEach(r => Para(doc, r));
  }

  Head(doc, "Intelligence Gaps and Confidence");
  const unchecked = n.residents - n.known;
  Para(doc, `This assessment draws on ${basisLine(n.name).replace(/\.$/, "")}. ${unchecked > 0 ? `The activity of ${plural(unchecked, "resident")} was not checked in the latest collection, so activity figures are a lower bound. ` : "The activity of every resident was checked. "}${!n.king ? "The API did not provide leadership or alliance data, which limits the assessment of intentions. " : ""}Confidence in each judgment reflects the depth of the archive for ${n.name}: it is currently ${X.conf}. ${ESTIMATIVE_NOTE}`);
  addAnnexes(doc, n, persp);
  return doc;
}

// ---- Support Assessment: written for an ally ----
function supportAssessment(n, releasable) {
  const a = assess(n, n.name), X = anticipate(n, n), threats = threatsTo(n).slice(0, 6), live = n.towns.filter(t => !t.ruined);
  const doc = docBase("support", "SUP-" + codeOf(n.name), releasable, "SUPPORT ASSESSMENT", `${n.name.toUpperCase()}: RISKS, THREATS AND RECOMMENDED ACTIONS`, n.name.toUpperCase(),
    releasable ? `The Government of ${n.name}` : `The Crown Council, for onward release to ${n.name}`);
  doc.memo.push(["BASIS", basisLine(n.name)]);
  const over = live.filter(isOverclaimable), take = over.reduce((s, t) => s + overclaim(t).takeable, 0), soonOver = live.filter(t => isOverTarget(t) && !isOverclaimable(t));
  const lowAct = live.filter(t => t.count >= 2 && t.checked >= t.count && t.active / t.count < 0.34 && !X.ruin7.includes(t));
  Head(doc, "Purpose");
  Para(doc, `The Kingdom of The Bleeding Heart prepares this assessment for the Government of ${n.name} as a friend. It sets out, from the data the Kingdom's Ministry of Intelligence collects across Terra Nostra, the risks ${n.name} currently faces, the nations that threaten it, the towns that need attention, and the steps the Ministry recommends. It draws on ${basisLine(n.name).replace(/\.$/, "")}.`);
  Head(doc, "Summary");
  Para(doc, `The Ministry assesses ${n.name}'s overall risk as ${riskLevel(a.risk).label.toLowerCase()}, with a score of ${a.risk} out of 100. ${threats.length ? `The principal external threat${threats.length > 1 ? "s are" : " is"} ${andList(threats.slice(0, 2).map(t => t.n.name))}.` : "No nation currently shows hostile intent toward it."} ${X.ruin7.length + over.length ? `${plural(X.ruin7.length + over.length, "town")} need${X.ruin7.length + over.length === 1 ? "s" : ""} attention within the next seven days.` : "None of its towns is in immediate danger."} ${X.leaderLeft != null && X.leaderLeft < 14 ? `Leadership continuity is also at risk: ${n.king} must log in within ${plural(Math.max(0, Math.ceil(X.leaderLeft)), "day")} to retain the leadership.` : ""} Over the period under review its active membership has ${moved(anyDelta(X.tA))}, which the Ministry reads as ${X.gA > 0.04 ? "a nation gaining strength" : X.gA < -0.04 ? "a nation losing strength" : "broad stability"}.`);
  Head(doc, "Assessment of Risk");
  Para(doc, `The most immediate risk to any nation on Terra Nostra is the loss of towns to inactivity: a town falls to ruin once none of its residents has logged in for ${days()} days, and its contents can then be taken by anyone. ${X.ruin7.length ? `${plural(X.ruin7.length, "of the nation's towns")} will cross that threshold within seven days if nothing changes.` : `None of ${n.name}'s towns will cross that threshold within seven days on current activity.`}`);
  Para(doc, `The second risk is overclaim. A town may hold land in proportion to its active residents; any surplus can be taken by a neighbouring town. ${over.length ? `${plural(over.length, "town")} already hold${over.length === 1 ? "s" : ""} more land than ${over.length === 1 ? "its" : "their"} residents support, exposing ${plural(take, "chunk")}.` : "No town currently holds more land than its residents support."} ${soonOver.length ? `${plural(soonOver.length, "more town")} will reach that position within ${ocWindow()} days as inactive residents stop counting.` : ""}`);
  Para(doc, `Underlying both is the nation's level of activity. ${a.activeRate != null ? `${Math.round(a.activeRate * 100)} per cent of the members whose activity was checked have been online in the last thirty days, and ${nf(n.active7)} members were online in the last week.` : "Member activity could not be fully checked."} ${lowAct.length ? `In ${plural(lowAct.length, "town")}, fewer than a third of residents are active, which leaves them exposed to both risks over the coming weeks.` : ""} ${a.leaderGone ? "The leader has passed the inactivity limit, so leadership will change at the next daily purge." : ""}`);
  Head(doc, "Threat Assessment");
  if (threats.length) {
    for (const t of threats.slice(0, 4)) Para(doc, `${t.n.name} (strength ${t.a.strength} of 100, ${t.n.active30} active members) is assessed as ${STANCE[t.a.stance].label.toLowerCase()} toward ${n.name} with a hostility score of ${t.a.hostility}${t.a.reasons.length ? `, because it is ${andList(reasonsAs(t.a, n.name).slice(0, 3))}` : ""}. ${t.a.contact ? `${plural(t.a.contact, "of its towns")} lie within ${nf(CONTACT_RANGE)} blocks of ${n.name}'s. ` : "It does not border the nation directly. "}${t.tA != null ? `Its active membership has ${moved(t.tA)} over the period.` : ""} The Ministry judges that ${lcFirst(clause(anticipate(t.n, n).likely.text), t.n.name)}.`);
  } else Para(doc, `No nation currently shows hostile indicators toward ${n.name}. The Ministry will notify the Government promptly if that changes.`);
  Head(doc, "Holdings at Risk");
  if (X.ruin7.length) Para(doc, `The following towns will fall to ruin unless a resident logs in: ${andList(X.ruin7.slice(0, 10).map(t => `${t.name}, whose mayor is ${t.mayor}, before ${fmtDay(Date.now() + Math.max(0, etaOf(t)))}`))}${X.ruin7.length > 10 ? `, and ${X.ruin7.length - 10} others listed in Annex C` : ""}.`);
  if (over.length) Para(doc, `The following towns hold surplus land open to overclaim: ${andList(over.slice(0, 8).map(t => { const k = Math.ceil(overclaim(t).takeable / perRes()); return `${t.name} (${plural(overclaim(t).takeable, "chunk")} exposed, which about ${plural(k, "active resident")} would cover)`; }))}.`);
  if (lowAct.length) Para(doc, `Activity is low in ${andList(lowAct.slice(0, 6).map(t => `${t.name} (${t.active} of ${t.count} active)`))}. These towns are not in immediate danger but will become so if activity does not recover.`);
  if (!X.ruin7.length && !over.length && !lowAct.length) Para(doc, `No individual towns are at immediate risk.`);
  Head(doc, "Allies and Support Network");
  Para(doc, n.allies.length ? `${n.name}'s allies, ${andList(n.allies.map(x => { const m = findNation(x); return m ? `${x} (${m.active30} active members)` : x; }))}, command ${nf(n.allies.reduce((s, x) => s + (findNation(x)?.active30 || 0), 0))} active members between them. ${threats[0] ? (() => { const shared = nations.filter(m => m !== n && m.enemies.includes(threats[0].n.name) && !n.allies.includes(m.name)).slice(0, 3); return shared.length ? `${andList(shared.map(m => m.name))} also count${shared.length === 1 ? "s" : ""} ${threats[0].n.name} as an enemy and may be natural partners.` : ""; })() : ""}` : `${n.name} has no formal allies. The Ministry recommends it consider at least one defensive alliance.`);
  Head(doc, "Outlook");
  Para(doc, `The Ministry judges it ${X.likely.likelihood} that ${lcFirst(clause(X.likely.text), n.name)}. ${X.tA?.slope != null ? `On current trends, active membership will be about ${nf(Math.max(0, Math.round(n.active30 + X.tA.slope * 7)))} in seven days.` : ""} ${X.ruin7.length || over.length ? "Prompt action on the towns named above would materially improve this outlook." : "The nation is in a sound position provided activity is maintained."}`);
  Head(doc, "Recommended Actions");
  const recs = [];
  if (X.ruin7.length) recs.push(`The mayors or residents of ${andList(X.ruin7.slice(0, 5).map(t => t.name))} should log in before the dates given above. A single login by any resident resets a town's inactivity clock.`);
  if (over.length) recs.push(`The towns with surplus land should either recruit active residents to restore their claim limit or release edge chunks they do not need, which removes the opportunity for neighbours to take them.`);
  if (a.leaderGone || (X.leaderLeft != null && X.leaderLeft < 7)) recs.push(`${n.king} should log in, or the nation should prepare an orderly handover to an active member before the purge decides it.`);
  if (threats[0]) recs.push(`Border towns facing ${threats[0].n.name} should be kept active and within their claim limits, since these are the first towns an adversary would target.`);
  if (a.activeRate != null && a.activeRate < 0.5) recs.push(`A recruitment and re-engagement drive would strengthen the nation on every measure: inactive residents no longer count toward claim limits, so each returning member protects land as well as towns.`);
  recs.push(`The Kingdom of The Bleeding Heart will continue to monitor ${n.name}'s neighbours and will share warning of hostile movements as soon as they are detected.`);
  recs.forEach(r => Para(doc, r));
  Para(doc, ESTIMATIVE_NOTE, false);
  addAnnexes(doc, n, null);
  doc.distribution = releasable ? `Prepared by the Kingdom of The Bleeding Heart for the Government of ${n.name}. Releasable to ${n.name} and its allies.` : doc.distribution;
  return doc;
}

// ---- Daily Intelligence Summary ----
function intsum(releasable) {
  const home = findNation($("myNation").value), map = assessAll();
  const doc = docBase("intsum", "SUM", releasable, "DAILY INTELLIGENCE SUMMARY", `TERRA NOSTRA, ${new Date().toUTCString().slice(5, 16).toUpperCase()}`, "INTSUM",
    releasable ? "Allied governments of the Kingdom of The Bleeding Heart" : "The Crown Council; Ministry of Attack");
  doc.memo.push(["BASIS", basisLine(null)]);
  const ev24 = ARCHIVE.events.filter(e => e.at >= Date.now() - DAY), ev7 = ARCHIVE.events.filter(e => e.at >= Date.now() - 7 * DAY);
  const threats = home ? threatsTo(home).slice(0, 8) : [];
  const ruin72 = towns.filter(t => !t.ruined && !isProtected(t) && etaOf(t) != null && etaOf(t) < 3 * DAY).sort((a, b) => etaOf(a) - etaOf(b));
  const critical = nations.filter(n => map.get(n.name).risk >= 65 && n !== home);
  const movers = nations.map(n => ({ n, d:anyDelta(trend(n.name, "a30")) })).filter(x => x.d);
  const rising = movers.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5), falling = movers.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
  const by = t => ev24.filter(e => e.type === t);
  Head(doc, "Summary");
  Para(doc, `${threats[0] ? `${threats[0].n.name} remains the principal threat to the Kingdom, with a hostility score of ${threats[0].a.hostility} and a strength of ${threats[0].a.strength}. ` : "No nation currently shows hostile intent toward the Kingdom. "}${by("town_ruin").length ? `${plural(by("town_ruin").length, "town")} fell to ruin in the last twenty-four hours, ` : "No towns fell to ruin in the last twenty-four hours, "}and ${ruin72.length ? `${plural(ruin72.length, "more", "more")} ${ruin72.length === 1 ? "is" : "are"} forecast to fall within seventy-two hours` : "none is forecast to fall within seventy-two hours"}. ${ev7.filter(e => /^(ally|enemy)_add/.test(e.type)).length ? `The week brought ${plural(ev7.filter(e => /^(ally|enemy)_add/.test(e.type)).length, "new alliance or enmity", "new alliances or enmities")}, a sign of diplomatic movement.` : "The diplomatic map has been quiet this week."} ${critical.length ? `${plural(critical.length, "nation")} ${critical.length === 1 ? "is" : "are"} at critical risk: ${andList(critical.slice(0, 4).map(n => n.name))}.` : ""}`);
  Head(doc, "Significant Activity in the Last Twenty-Four Hours");
  if (!ev24.length) Para(doc, ARCHIVE.scans > 1 ? "No significant changes were recorded in the last twenty-four hours." : "This is the first collection in the archive; activity will be recorded from the next scan.");
  else {
    const sent = [];
    // one paragraph per kind of change
    if (by("town_ruin").length) { const g = [...by("town_ruin").reduce((m, e) => m.set(e.ns?.[0] || "", [...(m.get(e.ns?.[0] || "") || []), e.town]), new Map())].sort((a, b) => b[1].length - a[1].length);
      sent.push(`${plural(by("town_ruin").length, "town")} fell to ruin: ${andList(g.slice(0, 4).map(([na, ts]) => `${na ? `${count(ts.length)} in ${na}` : `${count(ts.length)} without a nation`} (${andList(ts.slice(0, 4))}${ts.length > 4 ? " and others" : ""})`))}`); }
    if (by("town_gone").length || by("town_new").length) sent.push([by("town_new").length ? `${plural(by("town_new").length, "new town")} ${by("town_new").length === 1 ? "was" : "were"} founded` : "", by("town_gone").length ? `${plural(by("town_gone").length, "town")} ${by("town_gone").length === 1 ? "was" : "were"} deleted` : ""].filter(Boolean).join(" and "));
    if (by("town_switch").length) sent.push(`${plural(by("town_switch").length, "town")} changed nation: ${andList(by("town_switch").slice(0, 4).map(e => `${e.town} moved from ${e.from} to ${e.to}`))}`);
    if (by("land").length) { const g = by("land").filter(e => e.d > 0), l = by("land").filter(e => e.d < 0);
      const gs = nf(g.reduce((s, e) => s + e.d, 0)), ls = nf(-l.reduce((s, e) => s + e.d, 0));
      sent.push(g.length && l.length ? `Major land changes were recorded in ${plural(by("land").length, "town")}: ${count(g.length)} claimed ${gs} chunks between them and ${count(l.length)} gave up ${ls}` : g.length ? `${plural(g.length, "town")} made major claims, adding ${gs} chunks between them` : `${plural(l.length, "town")} gave up significant land, ${ls} chunks in all`); }
    sent.forEach(x => Para(doc, cap1(x) + "."));
    const dip = ev24.filter(e => /^(ally|enemy)_/.test(e.type) && !ev24.some(o => o.type === e.type && o.ns[0] === e.who && o.who === e.ns[0] && o.ns[0] < e.ns[0]));
    if (dip.length) Para(doc, `On the diplomatic front, ${andList(dip.slice(0, 6).map(e => eventText(e, null)))}.`);
    if (by("leader_change").length) Para(doc, `Leadership changed in ${andList(by("leader_change").map(e => e.ns[0]))}, which may bring changes of direction.`);
  }
  Head(doc, "The Threat Picture");
  if (threats.length) for (const t of threats.slice(0, 3)) Para(doc, `${t.n.name} is ${STANCE[t.a.stance].label.toLowerCase()} toward the Kingdom (hostility ${t.a.hostility}, strength ${t.a.strength}, ${t.n.active30} active members${t.a.contact ? `, ${plural(t.a.contact, "town")} near ours` : ""}). ${t.a.reasons.length ? `It is ${andList(t.a.reasons.slice(0, 2))}. ` : ""}The Ministry judges that ${lcFirst(clause(anticipate(t.n, home).likely.text), t.n.name)}.`);
  else Para(doc, "No nation currently shows hostile indicators toward the Kingdom.");
  if (threats.length > 3) Para(doc, `${andList(threats.slice(3).map(t => t.n.name))} ${threats.length - 3 === 1 ? "completes" : "complete"} the threat board, which is set out in full in Annex A.`);
  if (!releasable) {
    Head(doc, "Opportunities");
    const raid = towns.filter(t => isSoon(t) && t.nation !== home?.name && !["ally", "friendly"].includes(map.get(t.nation)?.stance)).slice(0, 5);
    const oc = towns.filter(t => isOverclaimable(t) && t.nation !== home?.name && !["ally", "friendly"].includes(map.get(t.nation)?.stance)).sort((a, b) => overclaim(b).takeable - overclaim(a).takeable).slice(0, 5);
    Para(doc, raid.length ? `Raiding opportunities over the next few days include ${andList(raid.map(t => `${t.name}${t.nation ? ` (${t.nation})` : ""}, ${stateOf(t).text.toLowerCase()}`))}.` : "No raiding opportunities are expected in the next three days.");
    Para(doc, oc.length ? `The largest overclaim opportunities are ${andList(oc.map(t => `${t.name}${t.nation ? ` of ${t.nation}` : ""} with ${plural(overclaim(t).takeable, "chunk")}`))}.` : "There are no significant overclaim opportunities against non-allied towns.");
  }
  Head(doc, "Shifts in the Balance of Power");
  Para(doc, movers.length ? `${rising.length ? `The fastest-growing nations by active membership are ${andList(rising.map(x => `${x.n.name} (${signed(x.d)})`))}. ` : ""}${falling.length ? `The steepest declines are in ${andList(falling.map(x => `${x.n.name} (${signed(x.d)})`))}. ` : ""}${home ? `Over the same period the Kingdom's own active membership has ${moved(anyDelta(trend(home.name, "a30")))}.` : ""}` : "Shifts in the balance of power become measurable once the archive holds at least two collections.");
  Head(doc, "Diplomatic Developments This Week");
  const dip7 = ev7.filter(e => /^(ally|enemy)_/.test(e.type) && !ev7.some(o => o.type === e.type && o.ns[0] === e.who && o.who === e.ns[0] && o.ns[0] < e.ns[0]));
  const byDay = [...dip7.slice(-10).reduce((m, e) => m.set(fmtDay(e.at), [...(m.get(fmtDay(e.at)) || []), eventText(e, null)]), new Map())];
  Para(doc, byDay.length ? byDay.map(([d, xs]) => `On ${d}, ${andList(xs)}.`).join(" ") : "No alliances or enmities were made or broken this week.");
  Head(doc, "Forecast for the Next Seventy-Two Hours");
  const vac = nations.filter(n => n.kingLast != null && days() - (Date.now() - n.kingLast) / DAY < 3);
  Para(doc, `${ruin72.length ? `${plural(ruin72.length, "town")} ${ruin72.length === 1 ? "is" : "are"} forecast to fall to ruin, the first being ${andList(ruin72.slice(0, 6).map(t => `${t.name}${t.nation ? ` of ${t.nation}` : ""} around ${fmtDay(Date.now() + Math.max(0, etaOf(t)))}`))}. ` : "No towns are forecast to fall to ruin. "}${vac.length ? `Leadership is expected to change in ${andList(vac.map(n => n.name))}. ` : ""}${critical.length ? `The nations at critical risk, ${andList(critical.slice(0, 5).map(n => `${n.name} (${map.get(n.name).risk})`))}, should be watched for collapse.` : ""}`);
  for (const line of mlHeadlines()) Para(doc, line);
  if (home) {
    Head(doc, "The Kingdom");
    const ha = map.get(home.name);
    Para(doc, `${home.name} holds ${plural(home.towns.filter(t => !t.ruined).length, "town")} with ${nf(home.active30)} active members and ${plural(home.chunks, "chunk")}. Its strength score is ${ha.strength} and its risk score ${ha.risk} (${riskLevel(ha.risk).label.toLowerCase()}). ${plural(threats.filter(t => t.a.contact).length, "hostile nation")} border${threats.filter(t => t.a.contact).length === 1 ? "s" : ""} Kingdom towns. ${ruinsWithin(home, 7).length ? `${plural(ruinsWithin(home, 7).length, "Kingdom town")} will fall within seven days unless residents log in: ${andList(ruinsWithin(home, 7).slice(0, 5).map(t => t.name))}.` : "No Kingdom town is at risk of ruin this week."}`);
  }
  Para(doc, ESTIMATIVE_NOTE, false);
  Annex(doc, "Annex A — Threat Board");
  if (threats.length) doc.sections.push({ type:"table", cols:[{ h:"Nation", w:2.3 }, { h:"Stance", w:1.1 }, { h:"Strength", w:1, align:"right" }, { h:"Hostility", w:1, align:"right" }, { h:"Near", w:.8, align:"right" }, { h:"Active ±", w:1, align:"right" }, { h:"Assessment", w:2.2 }],
    rows:threats.map(t => [t.n.name, STANCE[t.a.stance].label, t.a.strength, t.a.hostility, t.a.contact, signed(t.tA), t.a.flags.join(", ") || COA_LABEL[anticipate(t.n, home).likely.key]]) });
  else Para(doc, "No nation currently shows hostile indicators.", false);
  Annex(doc, "Annex B — Nations by Risk");
  doc.sections.push({ type:"table", cols:[{ h:"Nation", w:2.4 }, { h:"Stance", w:1.2 }, { h:"Risk", w:.8, align:"right" }, { h:"Strength", w:1, align:"right" }, { h:"Active", w:1, align:"right" }, { h:"Active ±", w:1, align:"right" }, { h:"Towns", w:.9, align:"right" }],
    rows:[...nations].sort((a, b) => map.get(b.name).risk - map.get(a.name).risk).slice(0, 40).map(n => { const x = map.get(n.name); return [n.name, STANCE[x.stance].label, x.risk, x.strength, n.active30, signed(anyDelta(trend(n.name, "a30"))), n.towns.filter(t => !t.ruined).length]; }) });
  if (ruin72.length) { Annex(doc, "Annex C — Towns Forecast to Fall Within 72 Hours");
    doc.sections.push({ type:"table", cols:[{ h:"Town", w:2.2 }, { h:"Nation", w:1.8 }, { h:"Mayor", w:1.6 }, { h:"Expected", w:1.2 }, { h:"Bank", w:1, align:"right" }], rows:ruin72.slice(0, 50).map(t => [t.name, t.nation || "—", t.mayor, fmtDay(Date.now() + Math.max(0, etaOf(t))), t.balance != null ? gold(t.balance) : "—"]) }); }
  return doc;
}
