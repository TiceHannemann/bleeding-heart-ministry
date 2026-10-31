/* ---------- Briefing Room page ---------- */
const BR = { kind:"intsum", nation:null, persp:null, releasable:false, q:"" };
try { Object.assign(BR, JSON.parse(localStorage.getItem("rh_br") || "{}"), { q:"" }); } catch {}
const saveBR = () => { try { localStorage.setItem("rh_br", JSON.stringify({ kind:BR.kind, nation:BR.nation, persp:BR.persp, releasable:BR.releasable })); } catch {} };
let brDoc = null;
async function renderBriefingRoom() {
  document.querySelectorAll("#brKinds button").forEach(b => b.classList.toggle("on", b.dataset.kind === BR.kind));
  document.querySelectorAll(".br-class button").forEach(b => b.classList.toggle("on", (b.dataset.rel === "1") === BR.releasable));
  $("brNationField").hidden = BR.kind === "intsum"; $("brPerspField").hidden = BR.kind !== "nation";
  const home = findNation($("myNation").value);
  renderArchiveStatus();
  if (!nations.length) { $("brDoc").innerHTML = `<div class="br-empty">Run a scan to open the Briefing Room. Every scan is added to the archive, so assessments sharpen over time.</div>`; brDoc = null; return; }
  // nation list: by threat for assessments, by risk (allies first) for support assessments
  const persp = findNation(BR.persp) || home;
  const q = BR.q.toLowerCase();
  let list = nations.filter(n => !q || n.name.toLowerCase().includes(q));
  if (BR.kind === "support") { const order = { home:0, ally:1, friendly:2 }; list.sort((a, b) => (order[assess(a).stance] ?? 3) - (order[assess(b).stance] ?? 3) || assess(b).risk - assess(a).risk); }
  else list.sort((a, b) => (assess(b, persp?.name)?.hostility || 0) * (assess(b).strength + 50) - (assess(a, persp?.name)?.hostility || 0) * (assess(a).strength + 50) || b.active30 - a.active30);
  if (!BR.nation || !findNation(BR.nation)) BR.nation = list.find(n => n !== home)?.name || list[0]?.name;
  $("brNations").innerHTML = list.slice(0, 200).map(n => { const a = assess(n, persp?.name);
    return `<button class="${n.name === BR.nation ? "on" : ""}" data-brn="${esc(n.name)}"><span class="sdot" style="--c:${STANCE[a.stance].c}"></span>${esc(n.name)}<em style="color:${riskLevel(assess(n).risk).c}">${assess(n).risk}</em></button>`; }).join("");
  const sel = $("brPersp"), opts = [home, ...nations.filter(n => n !== home).sort((a, b) => a.name.localeCompare(b.name))].filter(Boolean);
  if (sel.options.length !== opts.length) sel.innerHTML = opts.map(n => `<option value="${esc(n.name)}">${n === home ? "♥ " : ""}${esc(n.name)}</option>`).join("");
  sel.value = persp?.name || "";
  const n = findNation(BR.nation);
  brDoc = BR.kind === "intsum" ? intsum(BR.releasable) : BR.kind === "support" ? supportAssessment(n, BR.releasable) : nationAssessment(n, persp, BR.releasable);
  $("brDoc").innerHTML = docHtml(brDoc);
}
async function renderArchiveStatus() {
  const el = $("brArchive"); if (!el) return;
  const size = await archiveSize();
  el.innerHTML = ARCHIVE.scans ? `<b>Archive</b> ${ARCHIVE.scans.toLocaleString()} scan${ARCHIVE.scans === 1 ? "" : "s"} since ${new Date(ARCHIVE.first).toLocaleDateString()} · ${ARCHIVE.events.length.toLocaleString()} events in the last 60 days${size ? ` · ${(size / 1048576).toFixed(1)} MB stored` : ""}<br>Watch mode is <b>${WATCH.on ? `on, every ${WATCH.every} min` : "off"}</b>. ${WATCH.on ? "Leave this page open on a computer that stays on to collect around the clock." : "Turn it on under the scan button to collect around the clock."}
    <div class="br-arch-acts"><button class="deep" id="archExport">Export archive</button><label class="deep">Import archive<input type="file" id="archImport" accept=".json,application/json" hidden></label></div>`
    : `<b>Archive</b> empty. Each scan you run is stored here; trends, forecasts and anticipated moves need at least two.`;
}
document.addEventListener("click", async e => {
  const k = e.target.closest("#brKinds [data-kind]"); if (k) { BR.kind = k.dataset.kind; if (BR.kind === "support") { const h = findNation($("myNation").value); const al = nations.filter(n => assess(n).stance === "ally").sort((a, b) => assess(b).risk - assess(a).risk)[0]; BR.nation = (al || h)?.name; } saveBR(); renderBriefingRoom(); return; }
  const r = e.target.closest(".br-class [data-rel]"); if (r) { BR.releasable = r.dataset.rel === "1"; saveBR(); renderBriefingRoom(); return; }
  const nb = e.target.closest("[data-brn]"); if (nb) { BR.nation = nb.dataset.brn; saveBR(); renderBriefingRoom(); return; }
  if (e.target.id === "brPdf" && brDoc) { downloadPdf(brDoc); showToast(`Exported ${brDoc.id}.pdf`); return; }
  if (e.target.id === "brCopy" && brDoc) { navigator.clipboard?.writeText(docText(brDoc)).then(() => showToast("Briefing copied as text."), () => showToast("Couldn't copy.")); return; }
  if (e.target.id === "archExport") { exportArchive(); return; }
  const ob = e.target.closest("[data-open-brief]"); if (ob) { BR.kind = ob.dataset.kind || "nation"; BR.nation = ob.dataset.openBrief; saveBR(); location.hash = "#briefings"; return; }
});
document.addEventListener("change", async e => {
  if (e.target.id === "brPersp") { BR.persp = e.target.value; saveBR(); renderBriefingRoom(); }
  if (e.target.id === "archImport" && e.target.files[0]) { try { await importArchive(e.target.files[0]); showToast("Archive merged."); renderBriefingRoom(); } catch (err) { showToast(err.message || "Couldn't import that file."); } }
  if (e.target.id === "watchOn" || e.target.id === "watchEvery") {
    WATCH.on = $("watchOn").checked; WATCH.every = +$("watchEvery").value || 30;
    try { localStorage.setItem("rh_watch", JSON.stringify({ on:WATCH.on, every:WATCH.every })); } catch {}
    scheduleWatch(); if (tab === "briefings") renderArchiveStatus();
  }
});
document.addEventListener("input", e => { if (e.target.id === "brSearch") { BR.q = e.target.value; renderBriefingRoom(); } });
$("watchOn").checked = WATCH.on; $("watchEvery").value = String(WATCH.every);

// open the site straight away with the last saved scan, then keep collecting if watch mode is on
(async () => {
  await loadArchive();
  ARCHIVE.frame7 = await frameNear(Date.now() - 7 * DAY);
  let saved = null;
  try { saved = await idbDo(["meta"], "readonly", tx => reqP(tx.objectStore("meta").get("lastScan"))); } catch {}
  if (saved?.details?.length && !towns.length && !scanning) {
    hydrate(saved);
    enterApp();
    status(`Showing the scan from ${fmtDur(Date.now() - saved.at)} ago · ${ARCHIVE.scans.toLocaleString()} scans archived${WATCH.on ? "" : " · press Scan for fresh data"}`);
  }
  scheduleWatch();
})();
