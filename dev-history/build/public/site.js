// The public site reads only public facts from the EarthMC API: the nation's size and its towns.
const NATION = "Bleeding_Heart", API = "https://api.earthmc.net/v4";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
const post = (path, query) => fetch(API + path, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ query }) }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
let TOWNS = [];
function renderTowns() {
  const q = $("townSearch").value.trim().toLowerCase();
  const rows = TOWNS.filter(t => !q || t.name.toLowerCase().includes(q) || (t.mayor || "").toLowerCase().includes(q));
  $("townList").innerHTML = rows.length ? `<div class="p-towns-wrap"><table><tr><th>Town</th><th>Mayor</th><th class="num">Residents</th><th>Public spawn</th><th class="hide-sm">Founded</th></tr>${rows.map(t => `<tr>
      <td>${esc(t.name)}${t.capital ? '<span class="cap">Capital</span>' : ""}</td><td>${esc(t.mayor || "—")}</td><td class="num">${t.residents ?? "—"}</td>
      <td>${t.isPublic ? `<span class="yes">Open</span> <code>/t spawn ${esc(t.name)}</code>` : '<span class="no">Closed</span>'}</td>
      <td class="hide-sm">${t.founded ? new Date(t.founded).toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" }) : "—"}</td></tr>`).join("")}</table></div>`
    : `<p class="p-muted">${TOWNS.length ? "No towns match that search." : "The directory isn't available right now."}</p>`;
}
async function load() {
  try {
    const [n] = await post("/nations", [NATION]); if (!n) throw new Error("not found");
    const names = (n.towns || []).map(t => typeof t === "string" ? t : t.name).filter(Boolean), cap = n.capital?.name;
    const facts = [[names.length || n.stats?.numTowns, "Towns"], [n.stats?.numResidents ?? (n.residents || []).length, "Citizens"], [n.stats?.numTownBlocks, "Chunks of land"],
      [n.timestamps?.registered ? new Date(n.timestamps.registered).getFullYear() : null, "Founded"]].filter(([v]) => v != null);
    $("factsIn").innerHTML = facts.map(([v, l]) => `<div><b>${l === "Founded" ? v : Number(v).toLocaleString()}</b><span>${l}</span></div>`).join(""); $("facts").hidden = !facts.length;
    if (n.king?.name) $("crownLine").textContent = `The sovereign government of the Kingdom, led by ${n.king.name}${cap ? ` from the capital, ${cap}` : ""}.`;
    const towns = [];
    for (let i = 0; i < names.length; i += 100) towns.push(...await post("/towns", names.slice(i, i + 100)));
    TOWNS = towns.filter(t => t && !t.status?.isRuined).map(t => ({ name:t.name, mayor:t.mayor?.name, residents:t.stats?.numResidents ?? t.residents?.length, isPublic:!!t.status?.isPublic, founded:t.timestamps?.registered, capital:t.name === cap }))
      .sort((a, b) => b.capital - a.capital || (b.residents || 0) - (a.residents || 0));
    $("townsSub").textContent = `${TOWNS.length} towns, read live from the server. Towns with an open public spawn welcome visitors.`;
  } catch (e) { console.warn("Public directory unavailable:", e); }
  renderTowns();
}
$("townSearch").addEventListener("input", renderTowns);
document.querySelectorAll("img[data-crest]").forEach(i => { i.src = CREST; });
load();
