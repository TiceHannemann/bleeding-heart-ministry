// SHA-256 (pure JS, so it also works where crypto.subtle isn't available, e.g. some file:// pages)
function sha256(text) {
  const s = unescape(encodeURIComponent(text)), rr = (v, a) => (v >>> a) | (v << (32 - a)), mw = 2 ** 32;
  const k = sha256.k || (sha256.k = []), h0 = sha256.h || (sha256.h = []);
  if (!k.length) { const comp = {}; for (let c = 2, n = 0; n < 64; c++) if (!comp[c]) { for (let i = 0; i < 313; i += c) comp[i] = 1; h0[n] = (c ** .5 * mw) | 0; k[n++] = (c ** (1 / 3) * mw) | 0; } }
  let m = s + "\x80"; while (m.length % 64 - 56) m += "\x00";
  const words = [];
  for (let i = 0; i < m.length; i++) words[i >> 2] |= m.charCodeAt(i) << ((3 - i) % 4) * 8;
  words.push((s.length * 8 / mw) | 0, s.length * 8);
  let H = h0.slice(0, 8);
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16), old = H; H = H.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2], a = H[0], e = H[4];
      const t1 = H[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & H[5]) ^ (~e & H[6])) + k[i]
        + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
      H = [(t1 + t2) | 0, ...H]; H[4] = (H[4] + t1) | 0;
    }
    for (let i = 0; i < 8; i++) H[i] = (H[i] + old[i]) | 0;
  }
  return H.slice(0, 8).map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
}
