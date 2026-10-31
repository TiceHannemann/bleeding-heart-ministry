/* ---------- Holographic player cards ----------
   Click a mayor, leader or resident to open their card: skin (rendered live from their username by
   mc-heads.net; nothing is stored) and their public EarthMC profile, the same facts /res shows in game,
   plus the rest of their town as heads to click through. Player records come from the scan's cache,
   or are fetched one request at a time when a card needs one the scan skipped. */
const SKIN = {
  body:p => `https://mc-heads.net/body/${encodeURIComponent(p)}/240`,
  head:p => `https://mc-heads.net/avatar/${encodeURIComponent(p)}/48`,
  bodyAlt:p => `https://minotar.net/armor/body/${encodeURIComponent(p)}/240.png`,
  headAlt:p => `https://minotar.net/helm/${encodeURIComponent(p)}/48.png`,
};
const playerOf = name => cache.players[name]?.data || null;
async function loadPlayers(names) {
  const need = [...new Set(names)].filter(n => n && !playerOf(n));
  for (let i = 0; i < need.length; i += 100) {
    try { const got = await post("players", need.slice(i, i + 100)); const at = Date.now(); for (const p of got) if (p?.name) cache.players[p.name] = { at, data:p }; }
    catch { break; }
  }
}
const membersOf = town => {
  const d = scanData?.details.find(t => t.name === town);
  return d ? scanData.residentsOf(d) : [];
};
function holoDate(ts) { return ts ? new Date(ts).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }) : "—"; }

let holoToken = 0;
async function openHolo(name, town) {
  const token = ++holoToken, root = $("holo");
  root.hidden = false; root.classList.remove("out");
  document.body.classList.add("holo-open");
  renderHolo(name, town, true);
  await loadPlayers([name]);
  if (token !== holoToken) return;
  const p = playerOf(name);
  town ||= p?.town?.name || towns.find(t => t.mayor === name)?.name;
  renderHolo(name, town, false);
  // fill in the rest of the town in the background, then refresh the member strip
  const members = membersOf(town);
  if (members.some(m => !playerOf(m))) { await loadPlayers(members.slice(0, 200)); if (token === holoToken) $("holoMembers") && ($("holoMembers").innerHTML = membersHtml(name, town)); }
}
function closeHolo() {
  const root = $("holo"); if (root.hidden) return;
  holoToken++; root.classList.add("out"); document.body.classList.remove("holo-open");
  setTimeout(() => { if (root.classList.contains("out")) root.hidden = true; }, 260);
}
function membersHtml(current, town) {
  const t = towns.find(x => x.name === town), list = membersOf(town);
  if (!list.length) return `<div class="h-empty">Member list not in this scan.</div>`;
  const order = [...list].sort((a, b) => (b === t?.mayor) - (a === t?.mayor) || (playerOf(b)?.timestamps?.lastOnline || 0) - (playerOf(a)?.timestamps?.lastOnline || 0));
  return order.slice(0, 80).map(m => {
    const p = playerOf(m), last = p?.status?.isOnline ? Date.now() : p?.timestamps?.lastOnline;
    const state = last == null ? "" : Date.now() - last < 7 * 864e5 ? "on" : Date.now() - last < days() * 864e5 ? "idle" : "gone";
    return `<button class="h-mem ${m === current ? "cur" : ""} ${state}" data-player="${esc(m)}" data-town="${esc(town)}" title="${esc(m)}${m === t?.mayor ? " · mayor" : ""}${last ? " · last online " + esc(holoDate(last)) : ""}">
      <img src="${SKIN.head(m)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${SKIN.headAlt(m)}'">${m === t?.mayor ? "<i>♛</i>" : ""}</button>`;
  }).join("") + (order.length > 80 ? `<span class="h-more">+${order.length - 80}</span>` : "");
}
function renderHolo(name, town, loading) {
  const p = playerOf(name) || {}, st = p.status || {}, ts = p.timestamps || {}, stats = p.stats || {};
  const t = towns.find(x => x.name === (town || p.town?.name));
  const nation = p.nation?.name || t?.nation || "";
  const last = st.isOnline ? null : ts.lastOnline;
  const badges = [
    st.isOnline && `<span class="hb live">Online now</span>`,
    (st.isMayor || t?.mayor === name) && `<span class="hb">Mayor of ${esc(t?.name || p.town?.name || "")}</span>`,
    (st.isKing || nations.find(n => n.king === name)) && `<span class="hb">Leader of ${esc(nation)}</span>`,
    isPremium(p) && `<span class="hb gold">Premium</span>`,
    st.isNPC && `<span class="hb dim">NPC</span>`,
    hqTown()?.name === (t?.name || p.town?.name) && `<span class="hb hq">♥ Bleeding Heart</span>`,
  ].filter(Boolean).join("");
  const ranks = [...(p.ranks?.townRanks || []), ...(p.ranks?.nationRanks || [])];
  const row = (k, v) => `<div class="hr"><span>${k}</span><b>${v}</b></div>`;
  $("holoCard").innerHTML = `
    <button class="h-x" data-holo-close aria-label="Close">×</button>
    <div class="h-skin">
      <div class="h-beam"></div>
      <img class="h-body" src="${SKIN.body(p.uuid || name)}" alt="${esc(name)}'s skin" onerror="this.onerror=null;this.src='${SKIN.bodyAlt(name)}'">
      <div class="h-pad"></div>
    </div>
    <div class="h-info">
      <div class="h-kick">Player profile${loading ? " · loading" : ""}</div>
      <h3 class="h-name">${esc(name)}</h3>
      ${p.title || p.surname ? `<div class="h-title">${esc([p.title, p.surname].filter(Boolean).join(" "))}</div>` : ""}
      <div class="h-badges">${badges}</div>
      <div class="h-rows">
        ${row("Town", t ? `<button class="h-link" data-goto-town="${esc(t.name)}">${esc(t.name)}</button>` : esc(p.town?.name || "None"))}
        ${row("Nation", nation ? `<button class="h-link" data-goto-nation="${esc(nation)}">${esc(nation)}</button>` : "None")}
        ${ranks.length ? row("Ranks", esc(ranks.join(", "))) : ""}
        ${row("Last online", st.isOnline ? "Now" : last ? `${esc(ago(last))} <small>${esc(holoDate(last))}</small>` : loading ? "…" : "—")}
        ${row("Joined server", esc(holoDate(ts.registered)))}
        ${ts.joinedTownAt ? row("Joined town", esc(holoDate(ts.joinedTownAt))) : ""}
        ${stats.balance != null ? row("Balance", gold(stats.balance)) : ""}
        ${stats.numFriends != null ? row("Friends", stats.numFriends) : ""}
      </div>
      ${p.about && p.about !== "/res set about [msg]" ? `<p class="h-about">“${esc(p.about)}”</p>` : ""}
      <div class="h-kick" style="margin-top:18px">${t ? esc(t.name) + " · " : ""}members</div>
      <div class="h-members" id="holoMembers">${t ? membersHtml(name, t.name) : `<div class="h-empty">No town.</div>`}</div>
      <div class="h-foot">Skin from mc-heads.net · profile from the EarthMC API</div>
    </div>`;
}
const ago = ts => ts ? fmtDur(Date.now() - ts) + " ago" : "";
// a small "view mayor" chip used in the target panel
const mayorChip = t => t?.mayor && t.mayor !== "—" ? `<button class="pl-chip" data-player="${esc(t.mayor)}" data-town="${esc(t.name)}"><img src="${SKIN.head(t.mayor)}" alt="" onerror="this.style.visibility='hidden'">Mayor <b>${esc(t.mayor)}</b><span>· view profile and members</span></button>` : "";

document.addEventListener("click", e => {
  const pl = e.target.closest("[data-player]");
  if (pl) { e.preventDefault(); openHolo(pl.dataset.player, pl.dataset.town || ""); return; }
  if (e.target.closest("[data-holo-close]") || e.target.id === "holo") { closeHolo(); return; }
  const gt = e.target.closest("[data-goto-town]");
  if (gt) { const t = towns.find(x => x.name === gt.dataset.gotoTown); closeHolo(); if (t) { if (document.body.dataset.page === "dossier") location.hash = "#ruins"; selected = t; render(); scrollTo({ top:$("mapWrap").offsetTop - 20, behavior:"smooth" }); } return; }
  const gn = e.target.closest("[data-goto-nation]");
  if (gn) { closeHolo(); location.hash = "#dossier"; setTimeout(() => { const n = findNation(gn.dataset.gotoNation); if (n) { selNation = n.name; renderNations(); } }, 50); }
});
addEventListener("keydown", e => { if (e.key === "Escape") closeHolo(); });
// subtle 3D tilt following the pointer
$("holoCard").addEventListener("pointermove", e => {
  if (reduceMotion) return;
  const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  e.currentTarget.style.transform = `rotateY(${x * 7}deg) rotateX(${-y * 6}deg)`;
  e.currentTarget.style.setProperty("--gx", (x + .5) * 100 + "%"); e.currentTarget.style.setProperty("--gy", (y + .5) * 100 + "%");
});
$("holoCard").addEventListener("pointerleave", e => { e.currentTarget.style.transform = ""; });
