/* ---------- Server mode: hourly intelligence from the Ministry server ----------
   Added by the server when it sends this page. The server scans every hour; this pulls its archive
   (scans, series, events, Forecast Lab) into the browser's own store, so every page, assessment and
   briefing runs on the server's data. It only downloads when the server has something new. */
(() => {
  if (!window.BH_SERVER || window.BH_COLLECTOR) return;
  const VER_KEY = "bh_srv_ver";
  const getVer = () => { try { return localStorage.getItem(VER_KEY); } catch { return null; } };
  const setVer = v => { try { localStorage.setItem(VER_KEY, v); } catch {} };

  // with a password set, Lock signs out on the server too; without one it just returns to the ministry picker
  const lock = document.getElementById("lockBtn");
  // the hourly reports, as one more icon beside the Intelligence pages
  const nav = document.querySelector('nav.pages [data-m="intel"]') || document.querySelector("nav.pages");
  if (nav && !nav.querySelector("[data-hourly]")) {
    const a = document.createElement("a"); a.href = "/gov/reports"; a.dataset.hourly = "1"; a.dataset.tip = "Hourly reports"; a.setAttribute("aria-label", "Hourly reports");
    a.innerHTML = typeof ico === "function" ? ico("reports") : "Reports"; nav.appendChild(a);
  }
  // how fresh the server's data is: a dot in the corner, the details on hover
  const css = document.createElement("style");
  css.textContent = `.bh-srv{position:fixed;right:14px;bottom:14px;z-index:50;font:11px/1.4 var(--mono,monospace);color:#9aa;background:rgba(10,10,12,.88);border:1px solid #2a2a30;padding:7px 9px;max-width:calc(100vw - 28px)}
    .bh-srv .live-dot{margin-right:0}.bh-srv .bh-t{display:none;margin-left:8px}.bh-srv:hover .bh-t,.bh-srv.act .bh-t{display:inline}.bh-srv a{color:#7fe9ff}`;
  document.head.appendChild(css);
  const bar = document.createElement("div"); bar.className = "bh-srv";
  const say = (html, act) => { bar.innerHTML = `<i class="live-dot"></i><span class="bh-t">${html}</span>`; bar.classList.toggle("act", !!act); if (!bar.isConnected) document.body.appendChild(bar); };
  const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };

  async function apply(version) {
    say("Loading the latest scan…", true);
    const r = await fetch("/api/archive", { cache:"no-store" });
    if (!r.ok) throw new Error("archive HTTP " + r.status);
    const j = await r.json();
    await appReady;
    await idbDo(["meta", "series", "frames", "events", "predictions", "visits"], "readwrite", async tx => {
      for (const s of ["series", "frames", "events", "predictions"]) tx.objectStore(s).clear();
      const m = tx.objectStore("meta");
      for (const k of ["stats", "frame", "lastScan", "ml", "signals", "finance", "keyed"]) { if (j[k] != null) m.put(j[k], k); else m.delete(k); }
      const ser = tx.objectStore("series"); for (const s of j.series || []) if (s?.name) ser.put(s, s.name);
      const fr = tx.objectStore("frames"); (j.frameKeys || []).forEach((k, i) => { if (j.frames?.[i]) fr.put(j.frames[i], k); });
      const ev = tx.objectStore("events"); for (const e of j.events || []) ev.add(e);
      const pr = tx.objectStore("predictions"); for (const p of j.predictions || []) pr.put(p);
      // visits recorded in this browser (Movement Watch) are kept; the server's are added alongside
      const vk = v => v.at + "|" + v.player + "|" + v.town, have = new Set((MOVES.visits || []).map(vk)), vs = tx.objectStore("visits");
      for (const v of j.visits || []) if (v?.player && !have.has(vk(v))) { const { id, ...rec } = v; vs.add(rec); }
    });
    setVer(version);
    location.reload();
  }

  async function check(first) {
    let st;
    try { st = await (await fetch("/api/status", { cache:"no-store" })).json(); } catch { return say("Server unreachable", true); }
    if (st.error) { location.href = "/login?next=/gov"; return; }
    // with no password there is nothing to lock: the crest returns to the ministry picker
    if (lock && !lock.dataset.srv) {
      lock.dataset.srv = "1";
      if (st.open) lock.style.display = "none";
      else lock.onclick = () => { try { sessionStorage.removeItem("bh_unlocked"); } catch {} fetch("/logout", { method:"POST" }).finally(() => { location.href = "/login"; }); };
    }
    const line = st.lastOk ? `Scanned ${ago(st.lastOk)}${st.running ? " · scanning" : st.nextRun ? ` · next in ${Math.max(0, Math.round((st.nextRun - Date.now()) / 6e4))} min` : ""}`
      : st.running ? "First scan running" : "Waiting for the first scan";
    if (!st.archiveVersion || st.archiveVersion === getVer()) return say(line);
    if (first) return apply(st.archiveVersion).catch(e => say("Couldn't load: " + e.message, true));
    say(`New scan · <a href="#" id="bhSrvLoad">load</a>`, true);
    document.getElementById("bhSrvLoad").onclick = ev => { ev.preventDefault(); apply(st.archiveVersion).catch(e => say("Couldn't load: " + e.message)); };
  }
  check(true);
  setInterval(() => check(false), 5 * 6e4);
})();
