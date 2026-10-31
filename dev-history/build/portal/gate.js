// SHA-256 (pure JS, so it also works where crypto.subtle isn't available, e.g. some file:// pages)
function sha256(text) {
  const s = unescape(encodeURIComponent(text)), rr = (v, a) => (v >>> a) | (v << (32 - a)), mw = 2 ** 32;
  const k = sha256.k || (sha256.k = []), h0 = sha256.h || (sha256.h = []);
  if (!k.length) { const comp = {}; for (let c = 2, n = 0; n < 64; c++) if (!comp[c]) { for (let i = 0; i < 313; i += c) comp[i] = 1; h0[n] = (c ** .5 * mw) | 0; k[n++] = (c ** (1 / 3) * mw) | 0; } }
  let m = s + "\x80"; while (m.length % 64 - 56) m += "\x00";
  const words = [];
  for (let i = 0; i < m.length; i++) words[i >> 2] |= m.charCodeAt(i) << ((3 - i) % 4) * 8;
  words.push((s.length * 8 / mw) | 0, s.length * 8);
  let H = h0.slice(0, 8);
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16), old = H; H = H.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2], a = H[0], e = H[4];
      const t1 = H[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & H[5]) ^ (~e & H[6])) + k[i]
        + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
      H = [(t1 + t2) | 0, ...H]; H[4] = (H[4] + t1) | 0;
    }
    for (let i = 0; i < 8; i++) H[i] = (H[i] + old[i]) | 0;
  }
  return H.slice(0, 8).map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

/* ---------- Public portal and ministry gate ----------
   The site opens on the Kingdom's public portal. Each ministry asks for the password; a correct entry
   is remembered for this browser tab only, and Lock returns to the portal. Only a hash of the password
   is stored here. This keeps casual visitors out; it is not encryption, and the archive in this
   browser is not protected by it. */
const GATE_HASH = "3d163ccb31365431e6d456af3f1d3d93f49b9e5fd2bf02231bad7adb8371a1d2"; // sha256("bh-ministry:" + password)
const MINISTRY = { ruins:"attack", over:"attack", dossier:"intel", moves:"intel", briefings:"intel", forecasts:"intel" };
const MINISTRY_HOME = { attack:"#ruins", intel:"#dossier" };
const MINISTRY_NAME = { attack:"Ministry of Attack", intel:"Ministry of Intelligence" };
const unlocked = new Set((() => { try { return JSON.parse(sessionStorage.getItem("bh_unlocked") || "[]"); } catch { return []; } })());
const saveUnlocked = () => { try { sessionStorage.setItem("bh_unlocked", JSON.stringify([...unlocked])); } catch {} };
const RESUME_DIRECT = unlocked.size > 0; // reopened in an unlocked tab: straight back in, as before
const GATE = { ministry:null, ok:null, cancel:null, fails:0, until:0 };
function askPassword(m, ok, cancel) {
  if (unlocked.has(m)) return ok();
  Object.assign(GATE, { ministry:m, ok, cancel });
  $("gateTitle").textContent = MINISTRY_NAME[m]; $("gatePw").value = ""; $("gateForm").classList.remove("bad", "shake");
  if (Date.now() >= GATE.until) $("gateErr").textContent = "";
  $("gate").hidden = false; setTimeout(() => $("gatePw").focus(), 30);
}
function closeGate() { $("gate").hidden = true; const f = GATE.cancel; GATE.ok = GATE.cancel = null; f?.(); }
$("gateForm").addEventListener("submit", e => {
  e.preventDefault();
  if (Date.now() < GATE.until) return;
  if (sha256("bh-ministry:" + $("gatePw").value) === GATE_HASH) {
    unlocked.add(GATE.ministry); saveUnlocked(); GATE.fails = 0;
    $("gate").hidden = true; const f = GATE.ok; GATE.ok = GATE.cancel = null; f?.();
    return;
  }
  const card = $("gateForm"); card.classList.add("bad"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
  $("gatePw").value = ""; $("gatePw").focus();
  if (++GATE.fails < 5) { $("gateErr").textContent = "Incorrect password."; return; }
  // five wrong in a row: wait 30 seconds
  GATE.fails = 0; GATE.until = Date.now() + 30e3;
  const go = card.querySelector(".g-go"); go.disabled = true;
  (function tick() { const s = Math.ceil((GATE.until - Date.now()) / 1000);
    if (s <= 0) { go.disabled = false; $("gateErr").textContent = ""; return; }
    $("gateErr").textContent = `Too many attempts. Try again in ${s} seconds.`; setTimeout(tick, 250); })();
});
$("gateCancel").onclick = closeGate;
$("gate").addEventListener("click", e => { if (e.target.id === "gate") closeGate(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !$("gate").hidden) closeGate(); });

// the scan screen speaks for whichever ministry you came in through
const LANDING = {
  attack:{ kicker:"Kingdom of The Bleeding Heart — Ministry of Attack", title:"Ministry<br>of Attack", mods:["Ruin Hunter", "Overclaim Finder"],
    lede:"Scan every town on Terra Nostra to open the war room: ruins about to fall, land you can overclaim, and the routes to reach them first." },
  intel:{ kicker:"Kingdom of The Bleeding Heart — Ministry of Intelligence", title:"Ministry<br>of Intelligence", mods:["Nation Intelligence", "Movement Watch", "Briefing Room", "Forecast Lab"],
    lede:"Scan every town on Terra Nostra to brief the Crown: nation assessments, movements across our borders, intelligence briefings and forecasts." },
};
let savedScanAt = null;
function setLandingFor(m) {
  const L = LANDING[m] || LANDING.attack, label = m === "intel" ? "Intelligence" : "Attack";
  $("landing").setAttribute("aria-label", MINISTRY_NAME[m] || MINISTRY_NAME.attack);
  $("landKicker").textContent = L.kicker; $("landTitle").innerHTML = L.title; $("landLede").textContent = L.lede;
  $("landTitle").classList.toggle("long", m === "intel");
  $("landMods").innerHTML = L.mods.map(x => `<span><i>${label}</i>${x}</span>`).join("") + `<span class="l-lock">Opens after the scan</span>`;
  const r = $("landResume");
  r.hidden = !(towns.length && savedScanAt);
  if (!r.hidden) r.textContent = `Or open the latest intelligence, scanned ${fmtDur(Date.now() - savedScanAt)} ago →`;
}
$("landResume").onclick = () => enterApp();

// collection (watch mode, movement tracking) starts once someone is inside
let collecting = false;
function startCollection() { if (collecting) return; collecting = true; appReady.then(() => { scheduleWatch(); if (MOVES.on) pollMoves(); }); }
function enterMinistry(m) {
  history.replaceState(null, "", MINISTRY_HOME[m]); lastHash = location.hash; setPage(pageFromHash());
  setLandingFor(m);
  document.body.classList.remove("portal"); scrollTo(0, 0);
  runBoot(); startCollection();
}
document.addEventListener("click", e => {
  const d = e.target.closest("[data-ministry]"); if (d) { const m = d.dataset.ministry; askPassword(m, () => enterMinistry(m), () => {}); return; }
  const g = e.target.closest("[data-pgo]"); if (g) { e.preventDefault(); const el = $(g.dataset.pgo); if (el) $("portal").scrollTo({ top:el.offsetTop - 84, behavior:reduceMotion ? "auto" : "smooth" }); return; }
  if (e.target.closest("[data-ptop]")) { e.preventDefault(); $("portal").scrollTo({ top:0, behavior:"smooth" }); }
});
$("lockBtn").onclick = () => { unlocked.clear(); saveUnlocked(); document.body.classList.add("portal"); $("portal").scrollTop = 0; renderPortal(); };

// public figures for the Kingdom, and its public notices
function renderPortal() {
  const home = findNation($("myNation").value || "Bleeding_Heart");
  if (home) {
    const live = home.towns.filter(t => !t.ruined);
    $("pFactsIn").innerHTML = [[live.length, "Towns"], [home.residents, "Citizens"], [home.chunks, "Chunks of land"], [home.allies.length, home.allies.length === 1 ? "Allied nation" : "Allied nations"]]
      .map(([v, l]) => `<div><b>${Number(v || 0).toLocaleString()}</b><span>${l}</span></div>`).join("");
    $("pFacts").hidden = false;
  }
  const ev = home ? ARCHIVE.events.filter(e => e.at > Date.now() - 30 * DAY && ((e.type === "town_new" && e.ns?.[0] === home.name) || (["town_switch", "town_join"].includes(e.type) && e.to === home.name) || (e.type === "ally_add" && e.ns?.[0] === home.name))).slice(-3).reverse() : [];
  const items = ev.map(e => ({ when:new Date(e.at).toLocaleDateString(undefined, { day:"numeric", month:"long", year:"numeric" }),
    title:e.type === "ally_add" ? `The Crown welcomes an alliance with ${e.who}` : `${e.town} joins the Kingdom`,
    text:e.type === "ally_add" ? `The Kingdom of The Bleeding Heart and ${e.who} are now formally allied.` : `${e.town} is now a town of the Kingdom. Its residents are welcomed as citizens of the Crown.` }));
  items.push(
    { when:"Notice", title:"The Kingdom welcomes new settlers", text:"Mayors across the Kingdom are accepting new residents. Speak to any mayor in game to join a town of the Crown." },
    { when:"Notice", title:"Town spawns open for trade and travel", text:"Visitors are welcome at the Kingdom's public town spawns. Please respect the property and laws of each town." },
    { when:"Notice", title:"The Foreign Office is open to correspondence", text:"Nations seeking friendship or alliance with the Crown may make contact through any mayor of the Kingdom." });
  $("pNews").innerHTML = items.slice(0, 5).map(i => `<article><time>${esc(i.when)}</time><div><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div></article>`).join("");
}
document.querySelectorAll("img[data-crest]").forEach(i => { i.src = document.querySelector(".crest img").src; });
renderPortal();
