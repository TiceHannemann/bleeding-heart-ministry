/* ---------- Server mode: hourly intelligence from the Ministry server ----------
   Added by the server when it sends this page. The server scans every hour; this pulls its archive
   (scans, series, events, Forecast Lab) into the browser's own store, so every page, assessment and
   briefing runs on the server's data. It only downloads when the server has something new. */
(() => {
  if (!window.BH_SERVER || window.BH_COLLECTOR) return;
  const VER_KEY = "bh_srv_ver";
  const getVer = () => { try { return localStorage.getItem(VER_KEY); } catch { return null; } };
  const setVer = v => { try { localStorage.setItem(VER_KEY, v); } catch {} };

  // Lock signs out on the server too
  const lock = document.getElementById("lockBtn");
  if (lock) lock.onclick = () => { try { sessionStorage.removeItem("bh_unlocked"); } catch {} fetch("/logout", { method:"POST" }).finally(() => { location.href = "/"; }); };
  // a link to the hourly reports beside the ministry pages
  const nav = document.querySelector('nav.pages [data-m="intel"]') || document.querySelector("nav.pages");
  if (nav && !nav.querySelector("[data-hourly]")) {
    const a = document.createElement("a"); a.href = "/gov/reports"; a.dataset.hourly = "1"; a.textContent = "Hourly reports"; nav.appendChild(a);
  }
  // a quiet strip saying how fresh the server's data is
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:50;font:12px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#9aa;background:rgba(10,10,12,.85);border:1px solid #2a2a30;padding:6px 10px;border-radius:2px;max-width:calc(100vw - 24px)";
  const say = html => { bar.innerHTML = html; if (!bar.isConnected) document.body.appendChild(bar); };
  const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };

  async function apply(version) {
    say("Loading the latest hourly scan from the Ministry server…");
    const r = await fetch("/api/archive", { cache:"no-store" });
    if (!r.ok) throw new Error("archive HTTP " + r.status);
    const j = await r.json();
    await appReady;
    await idbDo(["meta", "series", "frames", "events", "predictions", "visits"], "readwrite", async tx => {
      for (const s of ["series", "frames", "events", "predictions"]) tx.objectStore(s).clear();
      const m = tx.objectStore("meta");
      for (const k of ["stats", "frame", "lastScan", "ml"]) { if (j[k] != null) m.put(j[k], k); else m.delete(k); }
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
    try { st = await (await fetch("/api/status", { cache:"no-store" })).json(); } catch { return say("Ministry server unreachable; showing the data saved in this browser."); }
    if (st.error) { location.href = "/login?next=/gov"; return; }
    const line = st.lastOk ? `Server scan ${ago(st.lastOk)}${st.running ? " · scanning now" : st.nextRun ? ` · next in ${Math.max(0, Math.round((st.nextRun - Date.now()) / 6e4))} min` : ""} · <a href="/gov/reports" style="color:#7fe9ff">reports</a>`
      : st.running ? "The server's first scan is running. Reports appear here when it finishes." : "Waiting for the server's first scan.";
    if (!st.archiveVersion || st.archiveVersion === getVer()) return say(line);
    if (first) return apply(st.archiveVersion).catch(e => say("Couldn't load the server's scan (" + e.message + "). " + line));
    say(`A new hourly scan is ready. <a href="#" id="bhSrvLoad" style="color:#7fe9ff">Load it</a> · ${line}`);
    document.getElementById("bhSrvLoad").onclick = ev => { ev.preventDefault(); apply(st.archiveVersion).catch(e => say("Couldn't load: " + e.message)); };
  }
  check(true);
  setInterval(() => check(false), 5 * 6e4);
})();
