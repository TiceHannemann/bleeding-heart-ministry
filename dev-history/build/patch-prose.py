import re,sys
D="/tmp/claude-0/-home-user/153b9aca-6ef6-5587-af34-315caaf6429b/scratchpad"
F="/home/user/earthmc-ruin-scanner.html"
s=open(F,encoding="utf-8").read()
def rep(old,new,count=1):
    global s
    if s.count(old)!=count: sys.exit(f"anchor count {s.count(old)} for: {old[:80]}")
    s=s.replace(old,new)
# 1. Times metrics
rep("""  F2:[278,333,474,""","""  F4:[250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541],
  F5:[250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520],
  F6:[250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541],
  F2:[278,333,474,""")
rep("""const PDF_SWAP =""","""// the same characters in Times (F4 roman, F5 bold, F6 italic)
const PDF_EXTRA_T = { "—":1000, "–":500, "•":350, "·":250, "’":333, "‘":333, "“":444, "”":444, "…":1000, "°":400, "×":564, "±":564, "é":444, "è":444, "á":444, "ö":500, "ü":500, "ñ":500 };
const PDF_SWAP =""")
rep("""    const e = PDF_EXTRA[ch]; w += e ? e[font === "F2" ? 2 : 1] : PDF_WIDTHS[font][ch.charCodeAt(0) - 32];""",
"""    const e = PDF_EXTRA[ch]; w += e ? (font > "F3" ? PDF_EXTRA_T[ch] : e[font === "F2" ? 2 : 1]) : PDF_WIDTHS[font][ch.charCodeAt(0) - 32];""")
# 2. word spacing for justified lines
rep("""      cur.ops.push(`BT /${font} ${pf(size)} Tf ${cs ? pf(cs) + " Tc " : ""}${prgb(o.color || [17, 17, 17])} rg ${pf(xx)} ${pf(PDF_H - y)} Td (${pdfEscape(str)}) Tj ${cs ? "0 Tc " : ""}ET`);""",
"""      cur.ops.push(`BT /${font} ${pf(size)} Tf ${cs ? pf(cs) + " Tc " : ""}${o.ws ? pf(o.ws) + " Tw " : ""}${prgb(o.color || [17, 17, 17])} rg ${pf(xx)} ${pf(PDF_H - y)} Td (${pdfEscape(str)}) Tj ${cs ? "0 Tc " : ""}${o.ws ? "0 Tw " : ""}ET`);""")
rep("""      const F3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");""",
"""      const F3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
      const F4 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>");
      const F5 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>");
      const F6 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>");""")
rep("""/F3 ${F3} 0 R >>""","""/F3 ${F3} 0 R /F4 ${F4} 0 R /F5 ${F5} 0 R /F6 ${F6} 0 R >>""")
# 3. memo block in Times
rep("""    const lines = pdfWrap(v, "F1", 9.5, W - 100);
    lines.forEach((ln, i) => P.text(L + 100, my + i * 12, ln, { font:k === "SUBJECT" ? "F2" : "F1", size:9.5 }));
    my += Math.max(1, lines.length) * 12 + 3;""","""    const mf = k === "SUBJECT" ? "F5" : "F4", lines = pdfWrap(v, mf, 10.5, W - 100);
    lines.forEach((ln, i) => P.text(L + 100, my + i * 13, ln, { font:mf, size:10.5 }));
    my += Math.max(1, lines.length) * 13 + 3;""")
# 4. body layout
a=s.index("  const para = (text, o = {}) => {\n    const size = o.size || 10")
b=s.index("  // running headers, classification banners")
s=s[:a]+open(f"{D}/build/pdfbody.js").read()+"\n"+s[b:]
# 5. generators
a=s.index("const H = (doc, text) => doc.sections.push")
b=s.index("// ---- Intelligence Assessment ----\nfunction nationAssessment")
keep="""const seriesPts = (name, key, scale = 1) => seriesOf(name).filter(p => p[PT[key]] != null).map(p => [p[0], p[PT[key]] * scale]);
const relTo = (n, p) => p ? assess(n, p.name) : assess(n);
"""
c=s.index("function docHtml(doc)")
prose=open(f"{D}/build/prose.js").read()
s=s[:a]+keep+prose+"\n"+s[c:]
# 6. docHtml + docText
a=s.index("function docHtml(doc)"); b=s.index("function downloadPdf(doc)")
s=s[:a]+open(f"{D}/build/dochtml.js").read()+"\n"+s[b:]
# 7. CSS
a=s.index("  .paper h4 {"); b=s.index("  @media (max-width:640px) { .paper {")
s=s[:a]+open(f"{D}/build/paper.css").read()+s[b:]
rep(".d-memo dd { margin:0; font-size:13px; }",".d-memo dd { margin:0; font:15px/1.45 var(--serif); }")
rep("  .paper { --band:#c4244e;","  .paper { --serif:\"Times New Roman\", Times, \"Liberation Serif\", Georgia, serif; --band:#c4244e;")
open(F,"w",encoding="utf-8").write(s); print("patched", len(s))
