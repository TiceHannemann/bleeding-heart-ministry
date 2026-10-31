function docHtml(doc) {
  const crest = document.querySelector(".crest img")?.src || "";
  let sn = 0, pn = 0, fig = 0, inAnnex = false;
  const sec = s => {
    if (s.type === "h") { sn++; pn = 0; return `<h4><span>${sn}.</span>${esc(s.text)}</h4>`; }
    if (s.type === "annex") { inAnnex = true; const [lab, ...rest] = s.text.split(" — "); return `<h3 class="d-annex"><b>${esc(lab)}</b>${rest.length ? `<i>${esc(rest.join(" — "))}</i>` : ""}</h3>`; }
    if (s.type === "p") return inAnnex ? `<p class="d-note">${esc(s.text)}</p>` : s.num === false ? `<p class="np d-aside"><span></span>${esc(s.text)}</p>` : `<p class="np"><span>${sn}.${++pn}</span>${esc(s.text)}</p>`;
    if (s.type === "bullets") return s.items.map(i => `<p class="np"><span>–</span>${esc(i)}</p>`).join("");
    if (s.type === "note") return `<p class="d-note">${esc(s.text)}</p>`;
    if (s.type === "table") return `<div class="d-tw"><table class="d-t"><tr>${s.cols.map(c => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.h)}</th>`).join("")}</tr>${s.rows.map(r => `<tr>${r.map((v, i) => `<td class="${s.cols[i].align === "right" ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</table></div>`;
    if (s.type === "chart") {
      const all = s.series.flatMap(x => x.pts);
      if (all.length < 2) return `<figure class="d-chart"><p class="d-note">Not enough history yet: the trend appears after several collections.</p><figcaption>${esc(s.title)}</figcaption></figure>`;
      let t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0])); if (t0 === t1) { t0 -= DAY; t1 += DAY; }
      const vmax = Math.max(1, ...all.map(p => p[1])), X = t => 40 + (t - t0) / (t1 - t0) * 540, Y = v => 110 - v / vmax * 100;
      return `<figure class="d-chart"><svg viewBox="0 0 600 130"><line x1="40" y1="110" x2="580" y2="110" stroke="#bbb"/><line x1="40" y1="10" x2="580" y2="10" stroke="#ddd" stroke-dasharray="2 3"/><text x="34" y="14" text-anchor="end" font-size="10" fill="#777">${short(vmax)}</text><text x="34" y="110" text-anchor="end" font-size="10" fill="#777">0</text>
        ${s.series.map(se => `<polyline fill="none" stroke="rgb(${se.color.join(",")})" stroke-width="1.4" points="${se.pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`).join("")}
        <text x="40" y="126" font-size="10" fill="#777">${fmtDay(t0)}</text><text x="580" y="126" font-size="10" fill="#777" text-anchor="end">${fmtDay(t1)}</text></svg>
        ${s.series.length > 1 ? `<div class="d-leg">${s.series.map(se => `<span style="--c:rgb(${se.color.join(",")})">${esc(se.name)}</span>`).join("")}</div>` : ""}<figcaption>${esc(s.title)}</figcaption></figure>`;
    }
    return "";
  };
  const firstAnnex = doc.sections.findIndex(s => s.type === "annex"), body = firstAnnex < 0 ? doc.sections : doc.sections.slice(0, firstAnnex), annexes = firstAnnex < 0 ? [] : doc.sections.slice(firstAnnex);
  return `<article class="paper ${doc.releasable ? "rel" : ""}">
    <div class="d-band">${esc(doc.classification)}</div>
    <header class="d-head"><img src="${crest}" alt=""><div><b>KINGDOM OF THE BLEEDING HEART</b><small>${esc(doc.office)}</small><em>${esc(doc.docTitle)}</em></div>
      <dl><dt>Document no.</dt><dd>${esc(doc.id)}</dd><dt>Date-time group</dt><dd>${esc(doc.dtg)}</dd></dl></header>
    <dl class="d-memo">${doc.memo.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${k === "SUBJECT" ? "subj" : ""}">${esc(v)}</dd>`).join("")}</dl>
    ${body.map(sec).join("")}
    <div class="d-sign"><span></span><b>${esc(doc.signer)}</b><small>Ministry of Intelligence, Kingdom of The Bleeding Heart</small>
      ${annexes.length ? `<p><b>Annexes:</b> ${esc(annexes.filter(s => s.type === "annex").map(s => s.text.replace(" — ", ". ")).join("; "))}.</p>` : ""}<p><b>Distribution:</b> ${esc(doc.distribution)}</p></div>
    ${annexes.map(sec).join("")}
    <div class="d-band">${esc(doc.classification)}</div>
  </article>`;
}
function docText(doc) {
  const out = [doc.classification, "", "KINGDOM OF THE BLEEDING HEART — " + doc.office, doc.docTitle, `${doc.id} · ${doc.dtg}`, "", ...doc.memo.map(([k, v]) => `${k}: ${v}`), ""];
  let sn = 0, pn = 0;
  for (const s of doc.sections) {
    if (s.type === "h") { sn++; pn = 0; out.push("", `${sn}. ${s.text}`, ""); }
    else if (s.type === "annex") out.push("", "", s.text.toUpperCase(), "");
    else if (s.type === "p") out.push((s.num === false ? "" : `${sn}.${++pn}  `) + s.text, "");
    else if (s.type === "note") out.push(s.text, "");
    else if (s.type === "bullets") s.items.forEach(i => out.push("– " + i));
    else if (s.type === "table") { out.push(s.cols.map(c => c.h).join(" | ")); s.rows.forEach(r => out.push(r.join(" | "))); out.push(""); }
    else if (s.type === "chart") out.push(`[${s.title}]`, "");
  }
  out.push("", doc.signer, "Ministry of Intelligence, Kingdom of The Bleeding Heart", "Distribution: " + doc.distribution, "", doc.classification);
  return out.join("\n");
}
