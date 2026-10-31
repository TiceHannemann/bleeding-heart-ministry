import sys
D="/tmp/claude-0/-home-user/153b9aca-6ef6-5587-af34-315caaf6429b/scratchpad"
F="/home/user/earthmc-ruin-scanner.html"
s=open(F,encoding="utf-8").read()
def rep(old,new,cnt=1):
    global s
    c=s.count(old)
    if c!=cnt: sys.exit(f"count {c}: {old[:100]}")
    s=s.replace(old,new)
# town model keeps resident names
rep("""    claims:(t.coordinates?.townBlocks || t.townBlocks || []).slice(0, 4000),""","""    claims:(t.coordinates?.townBlocks || t.townBlocks || []).slice(0, 4000),
    people:residentsOf(t), // names, so Movement Watch can tell residents from visitors""")
# IDB v3
rep("""indexedDB.open(IDB_NAME, 2)""","""indexedDB.open(IDB_NAME, 3)""")
rep("""      if (!has("predictions")) d.createObjectStore("predictions", { keyPath:"id", autoIncrement:true }).createIndex("status", "status");""",
"""      if (!has("predictions")) d.createObjectStore("predictions", { keyPath:"id", autoIncrement:true }).createIndex("status", "status");
      // v3: Movement Watch visits
      if (!has("visits")) d.createObjectStore("visits", { keyPath:"id", autoIncrement:true }).createIndex("at", "at");""")
# models
rep("""    prior:[-2.4, -1.9, -1.0, -0.3, 0.1] },
};""","""    prior:[-2.4, -1.9, -1.0, -0.3, 0.1] },
  // Movement Watch: a day of visits from one nation into another, then whether a hostile move follows
  probe7:{ label:"Hostile move after incursions", horizon:7, unit:"pair",
    names:["Baseline", "Visits in the last day", "Different visitors", "Average reconnaissance score", "Share judged reconnaissance", "Visitors' nation on the opposing side", "Already enemies", "Allies", "Near each other", "Visitors' nation strength", "Host's risk score", "Days with visits this week"],
    prior:[-2.6, 0.5, 0.4, 1.2, 1.0, 1.5, 0.6, -1.5, 0.5, 0.4, 0.6, 0.8] },
  // Movement Watch: is a visit reconnaissance? Learns from the labels you give visits, not from the event log
  scout:{ label:"Visit is reconnaissance", horizon:0, unit:"visit",
    names:["Baseline", "Time inside", "Time along the border", "Time at the town spawn", "Arrived by teleport", "Wandering path", "Visitor's nation on the opposing side", "Visitor's nation is an enemy", "Repeat visits this week", "Towns of that nation visited the same day", "Host is us or an ally"],
    prior:[-1.4, 0.5, 2.2, -2.4, -0.7, 0.7, 1.6, 1.0, 0.8, 1.2, 0.4] },
};""")
rep("""const featuresFor = (key, subj) => key === "ruin72" ? townFeatures(subj) : nationFeatures(subj, key);""",
"""const featuresFor = (key, subj) => key === "ruin72" ? townFeatures(subj) : key === "probe7" ? pairFeatures(subj) : key === "scout" ? visitFeatures(subj) : nationFeatures(subj, key);""")
rep("""  if (pr.model === "ruin72") hit = after.some(e => (e.type === "town_ruin" || e.type === "town_gone") && e.town === pr.subject) || !!towns.find(t => t.name === pr.subject && t.ruined);
  else {""","""  if (pr.model === "ruin72") hit = after.some(e => (e.type === "town_ruin" || e.type === "town_gone") && e.town === pr.subject) || !!towns.find(t => t.name === pr.subject && t.ruined);
  else if (pr.model === "probe7") {
    // a hostile move by the visitors' nation against the host: enmity, a broken alliance, a town taken, or land lost where they visited
    const [A, B] = pr.pair || pr.subject.split(" → ");
    hit = after.some(e => (["enemy_add", "ally_drop"].includes(e.type) && e.ns?.[0] === A && e.who === B) || (e.type === "town_switch" && e.from === B && e.to === A)
      || (e.type === "land" && e.d < 0 && e.ns?.[0] === B && (pr.towns || []).includes(e.town)));
  } else {""")
rep("""  const add = (key, subj, name) => {
    if (have.has(key + "|" + name)) return;
    const x = featuresFor(key, subj), pr = { model:key, subject:name, at:now, due:now + ML_MODELS[key].horizon * DAY, x, p:mlPredict(key, x), p0:mlPrior(key, x), status:"open" };""",
"""  const add = (key, subj, name, extra) => {
    if (have.has(key + "|" + name)) return;
    const x = featuresFor(key, subj), pr = { model:key, subject:name, at:now, due:now + ML_MODELS[key].horizon * DAY, x, p:mlPredict(key, x), p0:mlPrior(key, x), status:"open", ...extra };""")
rep("""  for (const n of nations) for (const key of ["loss7", "gain7", "diplo7", "leader7"]) add(key, n, n.name);""",
"""  for (const n of nations) for (const key of ["loss7", "gain7", "diplo7", "leader7"]) add(key, n, n.name);
  if (MOVES.loaded) for (const e of pairCandidates()) add("probe7", e, e.key, { pair:[e.A, e.B], towns:[...e.towns] });""")
# Forecast Lab card wording for the label-trained model
rep("""      <h3>${M.label}<small>within ${M.horizon === 3 ? "72 hours" : M.horizon + " days"}</small></h3>""","""      <h3>${M.label}<small>${!M.horizon ? "learned from your labels" : `within ${M.horizon === 3 ? "72 hours" : M.horizon + " days"}`}</small></h3>""")
rep("""<div><b>${m.n ? pct(m.pos / m.n) : "—"}</b><span>happened</span></div>""","""<div><b>${m.n ? pct(m.pos / m.n) : "—"}</b><span>${M.horizon ? "happened" : "were recon"}</span></div>""")
# module
rep("""/* ---------- Events ---------- */""", open(f"{D}/build/moves.js").read().replace("warp:tp || !s.trail.length && false,","warp:tp,")+"\n/* ---------- Events ---------- */")
# boot
rep("""  await loadML();
  ARCHIVE.frame7""","""  await loadML();
  await loadMoves();
  ARCHIVE.frame7""")
rep("""  scheduleWatch();
""","""  scheduleWatch();
  if (MOVES.on) pollMoves();
""",1)
# pages
rep("""  forecasts: { kicker:"Ministry of Intelligence — Forecast Lab",""","""  moves: { kicker:"Ministry of Intelligence — Movements", title:"MOVEMENT WATCH", tag:"Who is walking into whose land, and why. Read live from the server map.", sort:"", empty:"" },
  forecasts: { kicker:"Ministry of Intelligence — Forecast Lab",""")
rep("""const pageFromHash = () => ({ "#overclaim":"over", "#dossier":"dossier", "#briefings":"briefings", "#forecasts":"forecasts" })""","""const pageFromHash = () => ({ "#overclaim":"over", "#dossier":"dossier", "#briefings":"briefings", "#forecasts":"forecasts", "#moves":"moves" })""")
rep("""["dossier", "briefings", "forecasts"].includes(pg)""","""["dossier", "briefings", "forecasts", "moves"].includes(pg)""",2)
rep("""briefings:"Briefing Room", forecasts:"Forecast Lab" }[pg]""","""briefings:"Briefing Room", forecasts:"Forecast Lab", moves:"Movement Watch" }[pg]""")
rep("""  if (tab === "forecasts") { renderForecastLab(); return; }""","""  if (tab === "forecasts") { renderForecastLab(); return; }
  if (tab === "moves") { renderMoves(); return; }""")
rep("""  if (tab !== "dossier") (window.__warps || [])""","""  if (tab !== "dossier" && tab !== "moves") (window.__warps || [])""")
rep("""  if (tab === "dossier") drawIntelLayer(placed, zoomR, dot, spike);""","""  if (tab === "dossier") drawIntelLayer(placed, zoomR, dot, spike);
  else if (tab === "moves") drawMovesLayer(placed, zoomR, dot);""")
# CSS
rep("""  body:is([data-page="dossier"], [data-page="briefings"], [data-page="forecasts"]) .crest-text small""","""  body:is([data-page="dossier"], [data-page="briefings"], [data-page="forecasts"], [data-page="moves"]) .crest-text small""")
rep("""  body:is([data-page="dossier"], [data-page="briefings"], [data-page="forecasts"]) .ministry[data-m="intel"] .m-name""","""  body:is([data-page="dossier"], [data-page="briefings"], [data-page="forecasts"], [data-page="moves"]) .ministry[data-m="intel"] .m-name""")
rep("""body[data-page="forecasts"] .pages a[href="#forecasts"]::after {""","""body[data-page="forecasts"] .pages a[href="#forecasts"]::after, body[data-page="moves"] .pages a[href="#moves"]::after {""")
rep("""body[data-page="forecasts"] .pages a[href="#forecasts"] { color:var(--fg); }""","""body[data-page="forecasts"] .pages a[href="#forecasts"], body[data-page="moves"] .pages a[href="#moves"] { color:var(--fg); }""")
rep("""  body:is([data-page="dossier"], [data-page="briefings"], [data-page="forecasts"]) .kicker""","""  body:is([data-page="dossier"], [data-page="briefings"], [data-page="forecasts"], [data-page="moves"]) .kicker""")
rep("""  body[data-page="forecasts"] :is(.only-ruins,.only-over,.only-dossier,.not-dossier,.mapstage,.only-brief) { display:none !important; }""",
"""  body[data-page="forecasts"] :is(.only-ruins,.only-over,.only-dossier,.not-dossier,.mapstage,.only-brief) { display:none !important; }
  body[data-page="moves"] :is(.only-ruins,.only-over,.only-dossier,.not-dossier,.only-brief,.only-fore) { display:none !important; }
  body:not([data-page="moves"]) .only-moves { display:none !important; }
  /* Movement Watch */
  .mv-bar { display:flex; flex-wrap:wrap; align-items:center; gap:10px 22px; margin:0 0 22px; font-size:13px; color:var(--mut); }
  .mv-bar label { display:flex; align-items:center; gap:8px; } .mv-bar input[type=checkbox] { accent-color:var(--intel); }
  .mv-bar .mv-on { color:var(--fg); font-weight:600; }
  #mvState { font:12px var(--mono); color:var(--mut); }
  .mv-src { margin:-8px 0 24px; font-size:12.5px; color:var(--mut); }
  .mv-src summary { cursor:pointer; width:max-content; } .mv-src input { width:min(420px, 100%); margin:10px 10px 0 0; }
  .mv-src p { max-width:80ch; line-height:1.55; }
  #mvRelay { border-left:2px solid var(--orange); padding:10px 14px; margin:0 0 24px; font-size:13px; color:var(--mut); max-width:90ch; line-height:1.55; }
  #mvRelay code { font:12px var(--mono); color:var(--fg); }
  .stats.mv-stats { grid-template-columns:repeat(6,1fr); margin-top:28px; }
  @media (max-width:980px) { .stats.mv-stats { grid-template-columns:repeat(3,1fr); } }
  @media (max-width:560px) { .stats.mv-stats { grid-template-columns:repeat(2,1fr); } }
  .mv-cols { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:calc(var(--gut) * 1.5); margin-bottom:40px; }
  @media (max-width:980px) { .mv-cols { grid-template-columns:1fr; } }
  .mv-nat { font-size:12.5px; white-space:nowrap; } .mv-nat::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--c); margin-right:6px; vertical-align:1px; }
  .mv-pu { color:var(--c); font-size:12.5px; white-space:nowrap; }
  .mv-filter { display:flex; flex-wrap:wrap; gap:6px; margin:-4px 0 12px; }
  .mv-filter button, .mv-label button { background:none; border:1px solid var(--line2); color:var(--mut); font:500 11.5px var(--display); padding:3px 9px; cursor:pointer; }
  .mv-filter button.on, .mv-filter button:hover { color:#000; background:var(--intel); border-color:var(--intel); }
  .mv-label { white-space:nowrap; } .mv-label button + button { border-left:0; }
  .mv-label button.on { color:#000; background:var(--fg); border-color:var(--fg); } .mv-label button:hover { color:var(--fg); }
  .mv-visits-wrap { overflow-x:auto; }
  #mvModel { font-size:12.5px; color:var(--mut); margin-top:12px; }""")
# HTML
rep("""<a href="#briefings">Briefing Room</a><a href="#forecasts">Forecast Lab</a></div>""","""<a href="#moves">Movement Watch</a><a href="#briefings">Briefing Room</a><a href="#forecasts">Forecast Lab</a></div>""")
rep("""      <span class="only-ruins" style="--c:var(--red)">Ruined</span>""","""      <span class="only-moves" style="--c:var(--red)">Hostile player</span><span class="only-moves" style="--c:var(--orange)">Wary</span><span class="only-moves" style="--c:var(--blue)">Ally</span><span class="only-moves" style="--c:rgba(255,255,255,.55)">Other player</span>
      <span class="only-ruins" style="--c:var(--red)">Ruined</span>""")
rep("""  <section class="mapstage" id="mapWrap">""","""  <section class="only-moves">
    <div class="mv-bar">
      <label class="mv-on"><input type="checkbox" id="mvOn"> Track live positions</label>
      <label>every <select id="mvEvery"><option value="5">5 s</option><option value="10">10 s</option><option value="15">15 s</option><option value="30">30 s</option><option value="60">60 s</option></select></label>
      <button class="deep" id="mvNotify">Desktop alerts</button>
      <span id="mvState"></span>
    </div>
    <div id="mvRelay" hidden>The live map doesn't let other pages read its player feed, so the browser blocks it. A tiny relay on your own computer fixes that:
      <button class="deep" id="mvRelayGet">Download relay.py</button>, run <code>python relay.py</code>, then <button class="deep" id="mvRelayUse">Use relay</button>.</div>
    <details class="mv-src"><summary>Feed source</summary>
      <input id="mvSrc" placeholder="https://map.earthmc.net/tiles/players.json (default)">
      <p>Positions come from the live server map: every player it shows, refreshed every few seconds. Each position is matched to the claimed chunk under it. A visit is logged when someone stands in a town that isn't theirs and isn't in their nation. Players can be hidden from the live map, so not seeing someone proves nothing. Collection runs only while this page is open.</p>
    </details>
    <div class="stats mv-stats" id="mvStats"></div>
  </section>

  <section class="mapstage" id="mapWrap">""")
rep("""  <section class="only-brief briefroom">""","""  <section class="only-moves">
    <div class="mv-cols">
      <div class="panel"><h2>Inside our borders now</h2><div id="mvLive"></div></div>
      <div class="panel"><h2>Nation to nation <small>last 7 days</small></h2><div id="mvPairs"></div></div>
    </div>
    <div class="panel"><h2>Recent visits</h2>
      <div class="mv-filter"><button data-mvf="all">All</button><button data-mvf="ours">Into our land</button><button data-mvf="hostile">Hostile visitors</button><button data-mvf="recon">Reconnaissance</button><button data-mvf="unlabelled">Needs your call</button></div>
      <div class="mv-visits-wrap" id="mvVisits"></div><div id="mvModel"></div></div>
    <div class="mv-cols" style="margin-top:40px"><div class="panel"><h2>Frequent travellers <small>last 7 days</small></h2><div id="mvPeople"></div></div>
      <div class="panel"><h2>How it learns</h2><p class="lab-note" style="margin-top:0">Every visit gets a reconnaissance score from how the visitor behaved: time along the edge of the claims instead of at the town spawn, a wandering path, several towns of one nation in a day, return visits, and whose side they are on. Mark visits as Recon, Trade, Passing or Friendly and the model learns what scouting looks like on this server.<br><br>At each scan, every pair of nations with real traffic in the last day gets a Forecast Lab forecast: will the visitors' nation make a hostile move against the host within seven days (declare enmity, break an alliance, take a town, or cut land where they visited)? The event log checks the outcome, and the model adjusts.</p></div></div>
  </section>

  <section class="only-brief briefroom">""")
# reports
rep("""// ---- Intelligence Assessment ----
function nationAssessment""", open(f"{D}/build/moveprose.js").read()+"""
// ---- Intelligence Assessment ----
function nationAssessment""")
rep("""  Head(doc, "Military Potential");""","""  movementSection(doc, n, persp);

  Head(doc, "Military Potential");""")
rep("""Confidence in each judgment reflects the depth of the archive for ${n.name}: it is currently ${X.conf}. ${ESTIMATIVE_NOTE}`);
  addAnnexes(doc, n, persp);""","""Confidence in each judgment reflects the depth of the archive for ${n.name}: it is currently ${X.conf}. ${hasMoves() ? `Movement intelligence rests on ${plural(moveHoursIn(7), "hour")} of live-map collection this week, and players who hide from the map are not seen. ` : ""}${ESTIMATIVE_NOTE}`);
  addAnnexes(doc, n, persp);
  movementAnnex(doc, n, persp);""")
rep("""The Ministry judges that ${lcFirst(clause(anticipate(t.n, n).likely.text), t.n.name)}.`);
  } else Para(doc, `No nation currently shows hostile indicators toward ${n.name}.""","""${(tv => tv.length ? ` Its members were observed on ${plural(tv.length, "visit")} into ${n.name}'s territory this week, ${plural(tv.filter(v => v.purpose === RECON).length, "of them", "of them")} assessed as reconnaissance.` : "")(hasMoves() ? visitsBetween(t.n.name, n.name, Date.now() - 7 * DAY) : [])} The Ministry judges that ${lcFirst(clause(anticipate(t.n, n).likely.text), t.n.name)}.`);
  } else Para(doc, `No nation currently shows hostile indicators toward ${n.name}.""")
rep("""  Head(doc, "Forecast for the Next Seventy-Two Hours");""","""  movementIntsum(doc, releasable);
  Head(doc, "Forecast for the Next Seventy-Two Hours");""")
# archive export/import carries visits
rep("""  const data = await idbDo(["meta", "series", "frames", "events"], "readonly", async tx => ({""","""  const data = await idbDo(["meta", "series", "frames", "events", "visits"], "readonly", async tx => ({""")
rep("""    events:await reqP(tx.objectStore("events").getAll()),
  }));""","""    events:await reqP(tx.objectStore("events").getAll()), visits:await reqP(tx.objectStore("visits").getAll()),
  }));""")
rep("""  await idbDo(["meta", "series", "frames", "events"], "readwrite", async tx => {
    const ser = tx.objectStore("series");""","""  await idbDo(["meta", "series", "frames", "events", "visits"], "readwrite", async tx => {
    const vk = v => v.at + "|" + v.player + "|" + v.town, haveV = new Set(MOVES.visits.map(vk)), vst = tx.objectStore("visits");
    for (const v of j.visits || []) if (v?.player && typeof v.at === "number" && Array.isArray(v.x) && !haveV.has(vk(v))) { const { id, ...rec } = v; vst.add(rec); MOVES.visits.push(rec); }
    MOVES.visits.sort((a, b) => a.at - b.at);
    const ser = tx.objectStore("series");""")
open(F,"w",encoding="utf-8").write(s); print("patched",len(s))
