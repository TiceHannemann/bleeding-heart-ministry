// Builds compact world data for the map from a TopoJSON file (read as data only):
// simplified land rings + a 1-degree land mask.
const fs = require('fs');
const topo = JSON.parse(fs.readFileSync(process.argv[2]));
const { scale:[sx, sy], translate:[tx, ty] } = topo.transform;
// decode delta-encoded, quantized arcs
const arcs = topo.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]); });
const arcPts = i => i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
const ringOf = ids => { const pts = []; ids.forEach((id, k) => { const a = arcPts(id); pts.push(...(k ? a.slice(1) : a)); }); return pts; };
const rings = [];
const addPoly = poly => poly.forEach(ids => {
  const out = []; let px, py;
  for (const [x, y] of ringOf(ids)) {
    const rx = Math.round(x * 10) / 10, ry = Math.round(y * 10) / 10;
    if (rx === px && ry === py) continue;
    out.push(rx, ry); px = rx; py = ry;
  }
  if (out.length >= 8) rings.push(out);
});
const walk = g => g.type === 'GeometryCollection' ? g.geometries.forEach(walk) : g.type === 'Polygon' ? addPoly(g.arcs) : g.type === 'MultiPolygon' ? g.arcs.forEach(addPoly) : 0;
walk(topo.objects.land);
// 1-degree land mask via even-odd scanlines
const W = 360, H = 180, bits = new Uint8Array(W * H / 8);
let landCells = 0;
for (let row = 0; row < H; row++) {
  const lat = 89.5 - row, xs = [];
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length, x1 = r[i], y1 = r[i + 1], x2 = r[j], y2 = r[j + 1];
    if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + (lat - y1) / (y2 - y1) * (x2 - x1));
  }
  xs.sort((a, b) => a - b);
  for (let col = 0; col < W; col++) {
    const lon = -179.5 + col; let inside = false;
    for (const x of xs) { if (x > lon) break; inside = !inside; }
    if (inside) { const k = row * W + col; bits[k >> 3] |= 1 << (k & 7); landCells++; }
  }
}
const out = { rings, mask: Buffer.from(bits).toString('base64') };
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log('rings', rings.length, 'points', rings.reduce((n, r) => n + r.length / 2, 0), 'land cells', landCells, '(' + Math.round(landCells / 648) + '%)', 'bytes', JSON.stringify(out).length);
