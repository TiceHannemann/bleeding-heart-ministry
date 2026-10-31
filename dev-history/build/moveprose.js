// ---- movement intelligence, written for the reports ----
const hasMoves = () => MOVES.loaded && (MOVES.visits.length > 0 || MOVES.hours.size > 0);
const reconLine = vs => { const r = vs.filter(v => v.purpose === RECON).length; return r ? `the Ministry assesses ${r === vs.length && r > 1 ? "all of them" : `${count(r)} of them`} as probable reconnaissance` : "none of them bore the marks of reconnaissance"; };
const topCounts = (vs, key, k = 3) => [...vs.reduce((m, v) => v[key] ? m.set(v[key], (m.get(v[key]) || 0) + 1) : m, new Map())].sort((a, b) => b[1] - a[1]).slice(0, k);
function movementSection(doc, n, persp) {
  if (!hasMoves()) return;
  const week = Date.now() - 7 * DAY, hrs = moveHoursIn(7), coverage = `${plural(hrs, "hour")} of movement collection over the past week`;
  Head(doc, "Movements and Reconnaissance");
  if (persp && persp !== n) {
    const vs = visitsBetween(n.name, persp.name, week), ppl = topCounts(vs, "player"), tw = topCounts(vs, "town");
    Para(doc, vs.length ? `During ${coverage}, members of ${n.name} were observed on ${plural(vs.length, "visit")} into ${persp.name}'s territory, made by ${plural(new Set(vs.map(v => v.player)).size, "player")}; ${reconLine(vs)}. Reconnaissance is judged from how a visitor behaves: time spent along the edge of the claims rather than at the town spawn, a wandering path, several towns of the same nation in one day, and return visits. ${tw.length ? `The towns visited most were ${andList(tw.map(([t, k]) => `${t} (${plural(k, "visit")})`))}.` : ""} ${ppl.length ? `The most frequent visitor${ppl.length > 1 ? "s were" : " was"} ${andList(ppl.map(([p, k]) => `${p} (${plural(k, "visit")})`))}.` : ""}`
      : `During ${coverage}, no members of ${n.name} were observed inside ${persp.name}'s territory. Players can hide from the live map, so this does not prove that none entered.`);
    const f = pairForecast(n.name, persp.name);
    if (f) Para(doc, `The Forecast Lab, whose incursion model has been checked against ${nf(mlState().models.probe7.n)} real outcomes, judges it ${estimate(f.p)} (${pct(f.p)}) that this activity is followed within seven days by a hostile move against ${persp.name}: a declaration of enmity, a broken alliance, a town changing sides, or land lost in one of the towns visited.`);
  }
  const out = MOVES.visits.filter(v => v.at >= week && v.purpose !== PASSING && v.pn === n.name && v.nation && v.nation !== n.name);
  const inn = MOVES.visits.filter(v => v.at >= week && v.purpose !== PASSING && v.nation === n.name && v.pn !== n.name);
  if (out.length || inn.length) Para(doc, `${out.length ? `More broadly, ${n.name}'s members made ${plural(out.length, "visit")} to other nations' towns this week, most often to ${andList(topCounts(out, "nation").map(([x, k]) => `${x} (${k})`))}. ` : ""}${inn.length ? `Its own towns received ${plural(inn.length, "visit")} from outsiders, chiefly from ${andList(topCounts(inn, "pn").map(([x, k]) => `${x} (${k})`))}, and ${plural(inn.filter(v => v.purpose === RECON).length, "of them", "of them")} looked like reconnaissance.` : ""}`);
}
function movementAnnex(doc, n, persp) {
  if (!hasMoves() || !persp || persp === n) return;
  const vs = visitsBetween(n.name, persp.name, Date.now() - 7 * DAY).slice(-40).reverse(); if (!vs.length) return;
  Annex(doc, `Annex D — Recorded Visits by ${n.name} into ${persp.name}`);
  doc.sections.push({ type:"table", cols:[{ h:"When", w:1.4 }, { h:"Player", w:1.5 }, { h:"Town", w:1.6 }, { h:"Stay", w:.7, align:"right" }, { h:"Border", w:.8, align:"right" }, { h:"Spawn", w:.8, align:"right" }, { h:"Assessment", w:2.3 }],
    rows:vs.map(v => [`${fmtDay(v.at)} ${new Date(v.at).toUTCString().slice(17, 22)}`, v.player, v.town, durShort(v.dwell), pct(v.edge), pct(v.spawn), v.label ? "Confirmed " + v.label.toLowerCase() : v.purpose]) });
  Para(doc, "Border and Spawn give the share of the visit spent on claims at the edge of the town and within 24 blocks of its spawn. Times are UTC.", false);
}
function movementIntsum(doc, releasable) {
  if (!hasMoves()) return;
  const day = Date.now() - DAY, hrs = moveHoursIn(1), vs = MOVES.visits.filter(v => v.at >= day && v.purpose !== PASSING), home = homeNation();
  Head(doc, "Movements and Reconnaissance");
  if (!hrs && !vs.length) { Para(doc, "Movement Watch did not run in the last twenty-four hours, so no movement intelligence is available for the period."); return; }
  Para(doc, `In ${plural(hrs, "hour")} of movement collection over the last twenty-four hours, the Ministry recorded ${plural(vs.length, "visit")} by players to towns outside their own nation; ${reconLine(vs)}.`);
  const ours = vs.filter(v => isOurLand(v.nation) && ["hostile", "wary"].includes(stanceOf(v.pn)));
  if (home) Para(doc, ours.length ? `Members of hostile or wary nations made ${plural(ours.length, "visit")} into Kingdom or allied territory: ${andList(topCounts(ours, "pn", 4).map(([na, k]) => { const mine = ours.filter(v => v.pn === na); return `${na}, with ${plural(k, "visit")} by ${plural(new Set(mine.map(v => v.player)).size, "player")}, chiefly to ${andList(topCounts(mine, "town", 2).map(([t]) => t))}`; }))}.`
    : "No members of hostile or wary nations were observed inside Kingdom or allied territory.");
  const pairs = movePairs(day).filter(e => !isOurLand(e.B) || !["hostile", "wary"].includes(stanceOf(e.A))).slice(0, 3);
  if (pairs.length) Para(doc, `Elsewhere, the busiest traffic was ${andList(pairs.map(e => `from ${e.A} into ${e.B} (${plural(e.visits, "visit")}${e.recon ? `, ${count(e.recon)} judged reconnaissance` : ""})`))}.`);
  const fs = ML.open.filter(p => p.model === "probe7" && p.due > Date.now() && p.p >= 0.4).sort((a, b) => b.p - a.p).slice(0, 3);
  if (fs.length) Para(doc, `The Forecast Lab's incursion model rates the following patterns as the likeliest to precede a hostile move within seven days: ${andList(fs.map(p => `${p.pair[0]} in ${p.pair[1]} (${pct(p.p)})`))}.`);
}
