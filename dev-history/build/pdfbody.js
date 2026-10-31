  // body text: Times, justified, every paragraph numbered by section (1.1, 1.2 ...) like a staff paper
  const BODY = 10.8, LEAD = 15.4, NUMW = 30;
  const para = (text, o = {}) => {
    const size = o.size || BODY, font = o.font || "F4", lead = o.lead || size * 1.42, x = L + (o.indent || 0), w = W - (o.indent || 0);
    const lines = pdfWrap(text, font, size, w);
    need(Math.min(lines.length, 2) * lead);
    lines.forEach((ln, i) => {
      need(lead);
      if (i === 0 && o.label) P.text(L, y, o.label, { font, size, color:o.color });
      const sp = (ln.match(/ /g) || []).length, ws = o.justify !== false && i < lines.length - 1 && sp ? (w - pdfWidth(ln, font, size)) / sp : 0;
      P.text(x, y, ln, { font, size, color:o.color, ws:ws < 9 ? ws : 0 });
      y += lead;
    });
  };
  let sn = 0, pn = 0, fig = 0, inAnnex = false;
  const section = s => {
    if (s.type === "h") { sn++; pn = 0; need(LEAD * 3 + 12); y += 10; P.text(L, y, `${sn}.`, { font:"F5", size:11.5 }); P.text(L + NUMW, y, s.text, { font:"F5", size:11.5 }); y += 19; }
    else if (s.type === "annex") {
      inAnnex = true; newPage();
      const [lab, ...rest] = s.text.split(" — ");
      P.text(PDF_W / 2, y, lab.toUpperCase(), { font:"F5", size:12, cs:1.2, align:"center" }); y += 17;
      if (rest.length) { P.text(PDF_W / 2, y, rest.join(" — "), { font:"F6", size:11.5, align:"center" }); y += 30; }
    }
    else if (s.type === "p") {
      if (inAnnex) para(s.text, { size:9.5, font:"F6", color:GREY });
      else if (s.num === false) para(s.text, { indent:NUMW, size:9.8, font:"F6" });
      else { pn++; para(s.text, { indent:NUMW, label:`${sn}.${pn}` }); }
      y += 7;
    }
    else if (s.type === "bullets") { for (const it of s.items) para(it, { indent:NUMW, label:"–" }); y += 6; }
    else if (s.type === "note") { para(s.text, { indent:NUMW, size:9.5, font:"F6", color:GREY }); y += 6; }
    else if (s.type === "table") {
      // ruled table in the manner of a printed annex: rules above and below the header and at the foot
      const cols = s.cols, total = cols.reduce((a, c) => a + c.w, 0), sc = W / total, rowH = 14.5;
      const head = () => {
        need(rowH * 3); P.line(L, y - 11, R, y - 11, { w:.9 }); let x = L;
        for (const c of cols) { const cwid = c.w * sc; let hs = 9; while (hs > 6.5 && pdfWidth(c.h, "F5", hs) > cwid - 8) hs -= .5;
          P.text(c.align === "right" ? x + cwid - 4 : x + 4, y, c.h, { font:"F5", size:hs, align:c.align === "right" ? "right" : "left" }); x += cwid; }
        y += rowH; P.line(L, y - 11 - 1, R, y - 11 - 1, { w:.4 });
      };
      head();
      s.rows.forEach(row => {
        if (y + rowH > BOTTOM) { P.line(L, y - 11, R, y - 11, { w:.9 }); newPage(); head(); }
        let x = L;
        row.forEach((cell, ci) => {
          const c = cols[ci], cwid = c.w * sc; let t = String(cell ?? "");
          while (t.length > 1 && pdfWidth(t, "F4", 9.2) > cwid - 8) t = t.slice(0, -2) + "…";
          P.text(c.align === "right" ? x + cwid - 4 : x + 4, y, t, { font:"F4", size:9.2, align:c.align === "right" ? "right" : "left", color:c.color ? c.color(cell, row) : INK });
          x += cwid;
        });
        y += rowH;
      });
      P.line(L, y - 11, R, y - 11, { w:.9 });
      y += 12;
    }
    else if (s.type === "chart") {
      const H = 150; need(H + 40); fig++;
      const top = y, bx = L + 34, bw = W - 34, bh = H - 34;
      const all = s.series.flatMap(se => se.pts);
      if (all.length >= 2) {
        let t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0])); if (t0 === t1) { t0 -= 864e5; t1 += 864e5; }
        let vmax = Math.max(1, ...all.map(p => p[1])), vmin = Math.min(...all.map(p => p[1]));
        vmin = vmin > vmax * 0.5 ? Math.floor(vmin * 0.9) : 0;
        const X = t => bx + (t - t0) / (t1 - t0) * bw, Y = v => top + bh - (v - vmin) / Math.max(1e-9, vmax - vmin) * bh;
        for (let i = 0; i <= 3; i++) { const v = vmin + (vmax - vmin) * i / 3; P.line(bx, Y(v), bx + bw, Y(v), { w:.3, color:[205, 205, 210], dash:i ? [1.5, 2] : null }); P.text(bx - 5, Y(v) + 2.5, short(v), { font:"F4", size:7.5, color:GREY, align:"right" }); }
        P.text(bx, top + bh + 12, new Date(t0).toLocaleDateString(undefined, { day:"numeric", month:"short" }), { font:"F4", size:7.5, color:GREY });
        P.text(bx + bw, top + bh + 12, new Date(t1).toLocaleDateString(undefined, { day:"numeric", month:"short" }), { font:"F4", size:7.5, color:GREY, align:"right" });
        if (s.series.length > 1) { let lx = bx; for (const se of s.series) { P.rect(lx, top + bh + 18, 12, 1.4, { fill:se.color }); lx += 16 + P.text(lx + 16, top + bh + 21, se.name, { font:"F4", size:8, color:GREY }) + 16; } }
        for (const se of s.series) P.poly(se.pts.map(p => [X(p[0]), Y(p[1])]), { w:1.1, color:se.color });
      } else P.text(bx, top + 50, "Not enough history yet: the trend appears after several collections.", { font:"F6", size:9.5, color:GREY });
      y = top + H - 4;
      para(s.title, { font:"F6", size:9.5, justify:false }); y += 14;
    }
  };
  const firstAnnex = doc.sections.findIndex(s => s.type === "annex"), body = firstAnnex < 0 ? doc.sections : doc.sections.slice(0, firstAnnex);
  body.forEach(section);
  // signature and distribution close the main text; annexes follow
  need(120); y += 22;
  P.line(L + NUMW, y, L + NUMW + 190, y, { w:.6 }); y += 14;
  P.text(L + NUMW, y, doc.signer || "Director of Intelligence", { font:"F5", size:10.8 }); y += 13;
  P.text(L + NUMW, y, "Ministry of Intelligence, Kingdom of The Bleeding Heart", { font:"F4", size:10 }); y += 24;
  const tail = (label, text) => { P.text(L, y, label, { font:"F5", size:10 }); pdfWrap(text, "F4", 10, W - 72).forEach(ln => { need(14); P.text(L + 72, y, ln, { font:"F4", size:10 }); y += 14; }); y += 4; };
  if (firstAnnex >= 0) tail("Annexes:", doc.sections.filter(s => s.type === "annex").map(s => s.text.replace(" — ", ". ")).join("; ") + ".");
  tail("Distribution:", doc.distribution);
  if (firstAnnex >= 0) doc.sections.slice(firstAnnex).forEach(section);

