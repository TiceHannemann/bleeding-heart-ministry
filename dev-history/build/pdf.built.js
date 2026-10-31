/* ---------- PDF: official documents, written by hand ----------
   A small PDF 1.4 writer: the PDF standard fonts (Helvetica, Helvetica-Bold, Courier), so nothing
   needs embedding; vector lines, boxes and charts; and the crest as a JPEG. A briefing lays itself
   out onto A4 pages with automatic page breaks, then every page gets the letterhead (first page) or
   running header, classification banners, footer and page numbers. */
const PDF_W = 595.28, PDF_H = 841.89;
// Adobe metrics (1/1000 em) for character codes 32-126
const PDF_WIDTHS = {
  F1:[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  F2:[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
};
// characters outside ASCII that WinAnsi can print: [code, Helvetica width, Helvetica-Bold width]
const PDF_EXTRA = { "—":[0x97,1000,1000], "–":[0x96,556,556], "•":[0x95,350,350], "·":[0xB7,278,278], "’":[0x92,222,278], "‘":[0x91,222,278],
  "“":[0x93,333,500], "”":[0x94,333,500], "…":[0x85,1000,1000], "°":[0xB0,400,400], "×":[0xD7,584,584], "é":[0xE9,556,556], "è":[0xE8,556,556],
  "á":[0xE1,556,556], "ö":[0xF6,556,611], "ü":[0xFC,556,611], "ñ":[0xF1,556,611] };
const PDF_SWAP = { "♥":"", "★":"*", "▲":"+", "▼":"-", "♛":"", "→":"->", "←":"<-", "≥":">=", "≤":"<=", "✓":"" };
function pdfChars(str) {
  const out = [];
  for (const ch of String(str ?? "")) {
    if (ch in PDF_SWAP) { for (const c of PDF_SWAP[ch]) out.push(c); continue; }
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) out.push(ch); else if (PDF_EXTRA[ch]) out.push(ch); else if (code === 10) out.push(" "); else if (code > 126) out.push("?");
  }
  return out;
}
function pdfWidth(str, font, size, charSpace = 0) {
  const cs = pdfChars(str); let w = 0;
  for (const ch of cs) {
    if (font === "F3") { w += 600; continue; }
    const e = PDF_EXTRA[ch]; w += e ? e[font === "F2" ? 2 : 1] : PDF_WIDTHS[font][ch.charCodeAt(0) - 32];
  }
  return w / 1000 * size + charSpace * Math.max(0, cs.length - 1);
}
function pdfEscape(str) {
  let s = "";
  for (const ch of pdfChars(str)) {
    const e = PDF_EXTRA[ch];
    if (e) s += "\\" + e[0].toString(8).padStart(3, "0");
    else if (ch === "(" || ch === ")" || ch === "\\") s += "\\" + ch;
    else s += ch;
  }
  return s;
}
function pdfWrap(str, font, size, maxW) {
  const lines = [];
  for (const para of String(str ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + " " + word : word;
      if (pdfWidth(test, font, size) <= maxW || !line) line = test; else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}
const pf = n => (Math.round(n * 100) / 100).toString();
const prgb = c => c.map(v => pf(v / 255)).join(" ");

function makePdf() {
  const pages = []; let cur = null;
  const P = {
    addPage() { cur = { ops:[], bg:[] }; pages.push(cur); return pages.length - 1; },
    setPage(i) { cur = pages[i]; },
    get count() { return pages.length; },
    text(x, y, str, o = {}) {
      const font = o.font || "F1", size = o.size || 10, cs = o.cs || 0, w = pdfWidth(str, font, size, cs);
      const xx = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
      cur.ops.push(`BT /${font} ${pf(size)} Tf ${cs ? pf(cs) + " Tc " : ""}${prgb(o.color || [17, 17, 17])} rg ${pf(xx)} ${pf(PDF_H - y)} Td (${pdfEscape(str)}) Tj ${cs ? "0 Tc " : ""}ET`);
      return w;
    },
    line(x1, y1, x2, y2, o = {}) { cur.ops.push(`${pf(o.w || .5)} w ${prgb(o.color || [17, 17, 17])} RG ${o.dash ? `[${o.dash.join(" ")}] 0 d ` : ""}${pf(x1)} ${pf(PDF_H - y1)} m ${pf(x2)} ${pf(PDF_H - y2)} l S${o.dash ? " [] 0 d" : ""}`); },
    rect(x, y, w, h, o = {}) {
      const r = `${pf(x)} ${pf(PDF_H - y - h)} ${pf(w)} ${pf(h)} re`;
      if (o.fill) cur.ops.push(`${prgb(o.fill)} rg ${r} f`);
      if (o.stroke) cur.ops.push(`${pf(o.lw || .5)} w ${prgb(o.stroke)} RG ${r} S`);
    },
    poly(pts, o = {}) { if (pts.length < 2) return; cur.ops.push(`${pf(o.w || 1)} w ${prgb(o.color || [17, 17, 17])} RG 1 j ${pts.map(([x, y], i) => `${pf(x)} ${pf(PDF_H - y)} ${i ? "l" : "m"}`).join(" ")} S`); },
    dot(x, y, r, color) { const k = r * 0.5523; const Y = PDF_H - y; cur.ops.push(`${prgb(color)} rg ${pf(x + r)} ${pf(Y)} m ${pf(x + r)} ${pf(Y + k)} ${pf(x + k)} ${pf(Y + r)} ${pf(x)} ${pf(Y + r)} c ${pf(x - k)} ${pf(Y + r)} ${pf(x - r)} ${pf(Y + k)} ${pf(x - r)} ${pf(Y)} c ${pf(x - r)} ${pf(Y - k)} ${pf(x - k)} ${pf(Y - r)} ${pf(x)} ${pf(Y - r)} c ${pf(x + k)} ${pf(Y - r)} ${pf(x + r)} ${pf(Y - k)} ${pf(x + r)} ${pf(Y)} c f`); },
    image(name, x, y, w, h) { cur.ops.push(`q ${pf(w)} 0 0 ${pf(h)} ${pf(x)} ${pf(PDF_H - y - h)} cm /${name} Do Q`); },
    // faint diagonal text behind the page content
    watermark(str, size, gray) {
      const a = Math.PI / 5, c = Math.cos(a), s = Math.sin(a), w = pdfWidth(str, "F2", size);
      const x = PDF_W / 2 - c * w / 2, y = PDF_H / 2 - s * w / 2;
      cur.bg.push(`BT /F2 ${size} Tf ${pf(gray)} ${pf(gray)} ${pf(gray)} rg ${pf(c)} ${pf(s)} ${pf(-s)} ${pf(c)} ${pf(x)} ${pf(y)} Tm (${pdfEscape(str)}) Tj ET`);
    },
    build(meta = {}, images = {}) {
      const objs = [];
      const add = s => { objs.push(s); return objs.length; };
      add(""); add(""); // 1 catalog, 2 pages (filled below)
      const F1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      const F2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const F3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
      const xo = {};
      for (const [name, im] of Object.entries(images)) xo[name] = add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n${im.data}\nendstream`);
      const res = `<< /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R /F3 ${F3} 0 R >> /XObject << ${Object.entries(xo).map(([n, i]) => `/${n} ${i} 0 R`).join(" ")} >> >>`;
      const kids = [];
      for (const pg of pages) {
        const body = [...pg.bg, ...pg.ops].join("\n");
        const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pf(PDF_W)} ${pf(PDF_H)}] /Resources ${res} /Contents ${c} 0 R >>`));
      }
      objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
      objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
      const d = new Date(), stamp = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}00Z`;
      const info = add(`<< /Title (${pdfEscape(meta.title || "")}) /Author (${pdfEscape(meta.author || "")}) /Subject (${pdfEscape(meta.subject || "")}) /Producer (Kingdom of The Bleeding Heart - Ministry of Intelligence) /CreationDate (${stamp}) >>`);
      let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; const offs = [];
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
      return bytes;
    },
  };
  return P;
}

// ---- lay a briefing out as an official document ----
const CREST_JPEG = { data:atob("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"), w:157, h:240 };
const INK = [17, 17, 17], GREY = [110, 110, 116], RULE = [170, 170, 176], CRIMSON = [196, 36, 78], PAPER_TINT = [242, 243, 245];
function briefingPdf(doc) {
  const P = makePdf(), L = 56, R = PDF_W - 56, W = R - L, BOTTOM = PDF_H - 78;
  let y = 0;
  const classColor = doc.releasable ? [30, 90, 160] : CRIMSON;
  const newPage = () => { P.addPage(); y = P.count === 1 ? 236 : 118; if (doc.releasable) P.watermark("RELEASABLE TO ALLIES", 54, 0.94); };
  const need = h => { if (y + h > BOTTOM) newPage(); };
  newPage();
  // first-page letterhead and memorandum block
  const ch = 66, cw = ch * CREST_JPEG.w / CREST_JPEG.h;
  P.image("Crest", L, 44, cw, ch);
  P.text(L + cw + 14, 66, "KINGDOM OF THE BLEEDING HEART", { font:"F2", size:15, cs:.4 });
  P.text(L + cw + 14, 82, doc.office || "MINISTRY OF INTELLIGENCE", { font:"F1", size:8.5, cs:1.6, color:GREY });
  P.text(L + cw + 14, 98, doc.docTitle, { font:"F2", size:10.5, cs:.8, color:classColor });
  P.text(R, 60, "DOCUMENT NO.", { font:"F2", size:6.5, cs:1, color:GREY, align:"right" });
  P.text(R, 71, doc.id, { font:"F3", size:8.5, align:"right" });
  P.text(R, 86, "DATE-TIME GROUP", { font:"F2", size:6.5, cs:1, color:GREY, align:"right" });
  P.text(R, 97, doc.dtg, { font:"F3", size:8.5, align:"right" });
  P.line(L, 120, R, 120, { w:1.2 }); P.line(L, 123.5, R, 123.5, { w:.4 });
  let my = 142;
  for (const [k, v] of doc.memo) {
    P.text(L, my, k, { font:"F2", size:7.5, cs:.8, color:GREY });
    const lines = pdfWrap(v, "F1", 9.5, W - 100);
    lines.forEach((ln, i) => P.text(L + 100, my + i * 12, ln, { font:k === "SUBJECT" ? "F2" : "F1", size:9.5 }));
    my += Math.max(1, lines.length) * 12 + 3;
  }
  P.line(L, my + 2, R, my + 2, { w:.4, color:RULE });
  y = my + 24;

  const para = (text, o = {}) => {
    const size = o.size || 10, font = o.font || "F1", lead = size * 1.45, x = L + (o.indent || 0);
    for (const ln of pdfWrap(text, font, size, W - (o.indent || 0))) { need(lead); P.text(x, y, ln, { font, size, color:o.color }); y += lead; }
  };
  for (const s of doc.sections) {
    if (s.type === "h") { need(40); y += 8; P.text(L, y, s.text.toUpperCase(), { font:"F2", size:9.5, cs:.9 }); y += 5; P.line(L, y, R, y, { w:.4, color:RULE }); y += 14; }
    else if (s.type === "p") { para(s.text); y += 5; }
    else if (s.type === "bullets") { for (const it of s.items) { const lines = pdfWrap(it, "F1", 10, W - 16); need(14.5); P.text(L + 3, y, "•", { size:10 }); lines.forEach(ln => { need(14.5); P.text(L + 16, y, ln, { size:10 }); y += 14.5; }); y += 2; } y += 4; }
    else if (s.type === "kj") {
      // key judgments: a tinted box with a coloured rule, each judgment with its confidence
      const items = s.items.map(it => ({ ...it, lines:pdfWrap(it.text, "F1", 10, W - 34) }));
      const h = items.reduce((a, it) => a + it.lines.length * 14.5 + 13, 10);
      need(Math.min(h, 300));
      const top = y - 12;
      P.rect(L, top, W, h, { fill:PAPER_TINT }); P.rect(L, top, 2.5, h, { fill:classColor });
      y += 2;
      items.forEach((it, i) => {
        need(28);
        P.text(L + 14, y, String(i + 1) + ".", { font:"F2", size:10 });
        it.lines.forEach(ln => { P.text(L + 30, y, ln, { size:10 }); y += 14.5; });
        P.text(L + 30, y - 2, `${it.likelihood ? it.likelihood.toUpperCase() + " · " : ""}${(it.conf || "moderate").toUpperCase()} CONFIDENCE`, { font:"F2", size:6.5, cs:.9, color:GREY });
        y += 11;
      });
      y += 10;
    }
    else if (s.type === "table") {
      const cols = s.cols, total = cols.reduce((a, c) => a + c.w, 0), sc = W / total, rowH = 15;
      const head = () => { need(rowH * 2); P.rect(L, y - 11, W, rowH, { fill:[228, 229, 233] }); let x = L; for (const c of cols) { const cwid = c.w * sc; P.text(c.align === "right" ? x + cwid - 4 : x + 4, y, c.h.toUpperCase(), { font:"F2", size:7, cs:.5, align:c.align === "right" ? "right" : "left" }); x += cwid; } y += rowH; };
      head();
      s.rows.forEach((row, ri) => {
        if (y + rowH > BOTTOM) { newPage(); head(); }
        if (ri % 2) P.rect(L, y - 11, W, rowH, { fill:[247, 247, 249] });
        let x = L;
        row.forEach((cell, ci) => {
          const c = cols[ci], cwid = c.w * sc; let t = String(cell ?? "");
          while (t.length > 1 && pdfWidth(t, "F1", 8.5) > cwid - 8) t = t.slice(0, -2) + "…";
          P.text(c.align === "right" ? x + cwid - 4 : x + 4, y, t, { size:8.5, align:c.align === "right" ? "right" : "left", color:c.color ? c.color(cell, row) : INK });
          x += cwid;
        });
        y += rowH;
      });
      P.line(L, y - 11, R, y - 11, { w:.4, color:RULE });
      y += 8;
    }
    else if (s.type === "chart") {
      const H = 128; need(H + 34);
      P.text(L, y, s.title.toUpperCase(), { font:"F2", size:7.5, cs:.8, color:GREY }); y += 8;
      const top = y, bx = L + 34, bw = W - 34, bh = H - 22;
      const all = s.series.flatMap(se => se.pts);
      if (all.length >= 2) {
        let t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0])); if (t0 === t1) { t0 -= 864e5; t1 += 864e5; }
        let vmax = Math.max(1, ...all.map(p => p[1])), vmin = Math.min(...all.map(p => p[1]));
        vmin = vmin > vmax * 0.5 ? Math.floor(vmin * 0.9) : 0;
        const X = t => bx + (t - t0) / (t1 - t0) * bw, Y = v => top + bh - (v - vmin) / Math.max(1e-9, vmax - vmin) * bh;
        for (let i = 0; i <= 3; i++) { const v = vmin + (vmax - vmin) * i / 3; P.line(bx, Y(v), bx + bw, Y(v), { w:.3, color:[215, 215, 220] }); P.text(bx - 5, Y(v) + 2.5, short(v), { size:6.5, color:GREY, align:"right" }); }
        P.text(bx, top + bh + 12, new Date(t0).toLocaleDateString(undefined, { day:"numeric", month:"short" }), { size:6.5, color:GREY });
        P.text(bx + bw, top + bh + 12, new Date(t1).toLocaleDateString(undefined, { day:"numeric", month:"short" }), { size:6.5, color:GREY, align:"right" });
        let lx = bx;
        for (const se of s.series) {
          P.poly(se.pts.map(p => [X(p[0]), Y(p[1])]), { w:1.3, color:se.color });
          const last = se.pts[se.pts.length - 1]; if (last) P.dot(X(last[0]), Y(last[1]), 2.2, se.color);
          P.rect(lx, top + bh + 18, 10, 2, { fill:se.color }); lx += 14 + P.text(lx + 14, top + bh + 21, se.name, { size:7, color:GREY }) + 14;
        }
      } else P.text(bx, top + 40, "Not enough history yet: trends appear after several collections.", { size:8.5, color:GREY });
      y = top + H + 14;
    }
    else if (s.type === "note") { need(30); para(s.text, { size:8, color:GREY }); y += 4; }
  }
  // signature and distribution
  need(110); y += 18;
  P.line(L, y, L + 180, y, { w:.6 }); y += 13;
  P.text(L, y, doc.signer || "Director of Intelligence", { font:"F2", size:9.5 }); y += 12;
  P.text(L, y, "Ministry of Intelligence, Kingdom of The Bleeding Heart", { size:8.5, color:GREY }); y += 18;
  P.text(L, y, "DISTRIBUTION", { font:"F2", size:7, cs:.9, color:GREY }); y += 11;
  para(doc.distribution, { size:8.5 });

  // running headers, classification banners, footers and page numbers on every page
  for (let i = 0; i < P.count; i++) {
    P.setPage(i);
    P.rect(0, 0, PDF_W, 20, { fill:classColor });
    P.text(PDF_W / 2, 13.5, doc.classification, { font:"F2", size:8, cs:1.4, color:[255, 255, 255], align:"center" });
    P.rect(0, PDF_H - 20, PDF_W, 20, { fill:classColor });
    P.text(PDF_W / 2, PDF_H - 6.5, doc.classification, { font:"F2", size:8, cs:1.4, color:[255, 255, 255], align:"center" });
    if (i > 0) {
      P.image("Crest", L, 38, 26 * CREST_JPEG.w / CREST_JPEG.h, 26);
      P.text(L + 26 * CREST_JPEG.w / CREST_JPEG.h + 10, 52, "KINGDOM OF THE BLEEDING HEART · " + (doc.office || "MINISTRY OF INTELLIGENCE"), { font:"F2", size:7.5, cs:.9 });
      P.text(R, 52, doc.id, { font:"F3", size:7.5, align:"right", color:GREY });
      P.line(L, 74, R, 74, { w:.8 }); P.line(L, 76.5, R, 76.5, { w:.3 });
    }
    P.line(L, PDF_H - 50, R, PDF_H - 50, { w:.4, color:RULE });
    P.text(L, PDF_H - 38, `${doc.docTitle} · ${doc.subjectShort || ""}`, { size:7, color:GREY });
    P.text(R, PDF_H - 38, `Page ${i + 1} of ${P.count}`, { font:"F2", size:7, color:GREY, align:"right" });
  }
  return P.build({ title:`${doc.docTitle} - ${doc.subjectShort || ""}`, author:"Ministry of Intelligence, Kingdom of The Bleeding Heart", subject:doc.memo.find(m => m[0] === "SUBJECT")?.[1] }, { Crest:CREST_JPEG });
}
