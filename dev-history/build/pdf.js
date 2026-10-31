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
const CREST_JPEG = { data:atob("__CREST__"), w:__CW__, h:__CH__ };
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
