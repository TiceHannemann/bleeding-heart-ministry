// Ministry of Finance. Two parts:
//   1. synthetic: a fake EarthMC API with known transfers, to check flows, movers and the property market
//   2. live (with --live): a real deep scan of every player and quarter, then the three Finance pages and the reports
// Usage: node tests/finance-test.js <archive.json.gz from a server scan> [--live]
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib'), http = require('http');
const [archive] = process.argv.slice(2), LIVE = process.argv.includes('--live');
const A = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)));
const bankInput = scan => ({
  towns:scan.details.map(t => { const s = t.coordinates?.spawn; return [t.name, t.nation?.name || null, t.stats?.balance ?? 0, t.stats?.forSalePrice ?? null, s ? Math.round(s.x) : null, s ? Math.round(s.z) : null, t.stats?.numResidents ?? 0]; }),
  nations:Object.values(scan.nationDetails || {}).map(n => [n.name, n.stats?.balance ?? 0]),
});

async function synthetic() {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-fin-'));
  // three players, two quarters for sale (one far below the local rate), then a payment of 123.45g from Ann to Bob
  const P = { Ann:[1000, 'Alpha', 'Rome'], Bob:[50, 'Beta', 'Gaul'], Cy:[400, 'Alpha', 'Rome'] };
  const Q = [{ uuid:'q1', name:'Cheap Flat', price:100, volume:200, sale:true, town:'Alpha', nation:'Rome' }, ...Array.from({ length:5 }, (_, i) => ({ uuid:'q' + (i + 2), name:'Flat ' + i, price:900 + i * 10, volume:200, sale:true, town:'Alpha', nation:'Rome' }))];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const q = b ? JSON.parse(b).query : null;
      if (req.url === '/players') return res.end(JSON.stringify(q ? q.map(n => ({ name:n, stats:{ balance:P[n][0] }, town:{ name:P[n][1] }, nation:{ name:P[n][2] } })) : Object.keys(P).map(name => ({ name }))));
      if (req.url === '/quarters') return res.end(JSON.stringify(q ? Q.filter(x => q.includes(x.uuid)).map(x => ({ uuid:x.uuid, name:x.name, type:'APARTMENT', town:{ name:x.town }, nation:{ name:x.nation }, owner:{ name:'Cy' },
        status:{ isForSale:x.sale }, stats:{ price:x.price, volume:x.volume }, cuboids:[{ cornerOne:[0, 60, 0], cornerTwo:[10, 64, 10] }] })) : Q.map(x => ({ uuid:x.uuid }))));
      res.statusCode = 404; res.end('[]');
    });
  }).listen(8796);
  process.env.EMC_API = 'http://127.0.0.1:8796';
  const finance = require('../server/finance.js');
  const banks = { towns:[['Alpha', 'Rome', 500, null, 0, 0, 2], ['Beta', 'Gaul', 300, 250, 3000, 0, 1]], nations:[['Rome', 100], ['Gaul', 20]] };
  finance.hourly(banks);
  await finance.deepScan();
  P.Ann[0] -= 123.45; P.Bob[0] += 123.45; Q[0].price = 80; // the payment, and a price cut
  await finance.deepScan();
  const f = finance.hourly(banks);
  console.log('synthetic flows:', f.flows.map(x => `${x.a.n} → ${x.b.n} ${x.amt}g (${x.conf})`).join('; ') || 'none');
  console.log('synthetic corridors:', f.corridors.map(c => `${c.from}→${c.to} ${c.amt}g`).join('; '));
  console.log('synthetic movers:', f.movers.up3.map(m => `${m.n} +${m.d}`).join(', '), '|', f.movers.down3.map(m => `${m.n} ${m.d}`).join(', '));
  console.log('synthetic property: idx', f.property.idx, '| steals', f.property.steals.map(q => `${q.name} ${q.price}g (${Math.round((1 - q.ratio) * 100)}% under)`).join(', '), '| cuts', f.property.cuts.map(q => `${q.name} ${q.prev}→${q.price}`).join(', '));
  console.log('synthetic towns for sale:', f.property.townsForSale.map(t => `${t.n} ${t.price}g, bank ${t.bank}g`).join(', '));
  console.log('synthetic nations:', f.nations.map(n => `${n.n} ${n.wealth}g (players ${n.players}, banks ${n.bank + n.towns})`).join('; '));
  srv.close();
  // the live part needs its own data folder: forget the modules that captured this one
  for (const m of ['../server/finance.js', '../server/paths.js']) delete require.cache[require.resolve(m)];
}

async function live() {
  // --reuse=<dir> re-reads a folder from an earlier live run instead of scanning the API again
  const reuse = (process.argv.find(a => a.startsWith('--reuse=')) || '').slice(8);
  process.env.DATA_DIR = reuse || fs.mkdtempSync(path.join(os.tmpdir(), 'bh-finlive-'));
  delete process.env.EMC_API;
  const finance = require('../server/finance.js');
  if (!reuse) {
    finance.hourly(bankInput(A.lastScan));
    const r = await finance.deepScan();
    console.log(`\nlive deep scan: ${r.players.toLocaleString()} players, ${r.quarters.toLocaleString()} quarters in ${r.seconds}s`);
  }
  const f = finance.hourly(bankInput(A.lastScan));
  const json = JSON.stringify(f);
  console.log(`page data: ${(json.length / 1024).toFixed(0)} KB`);
  console.log(`totals: all ${Math.round(f.totals.all).toLocaleString()}g · players ${Math.round(f.totals.players).toLocaleString()}g · towns ${Math.round(f.totals.towns).toLocaleString()}g · nations ${Math.round(f.totals.nations).toLocaleString()}g`);
  console.log('top nations:', f.nations.slice(0, 6).map(n => `${n.n} ${Math.round(n.wealth).toLocaleString()}g`).join(', '));
  console.log('richest:', f.richest.slice(0, 5).map(p => `${p.n} (${p.nation || '-'}) ${Math.round(p.bal).toLocaleString()}g`).join(', '));
  console.log(`property: ${f.property.count} for sale · median asking ${f.property.idx}g · ${f.property.steals.length} steals · ${f.property.townsForSale.length} towns for sale`);
  console.log('steals:', f.property.steals.slice(0, 5).map(q => `${q.name}, ${q.town} (${q.nation}) ${q.price}g for ${q.vol} blocks; similar ask ${q.ref}g`).join(' | '));
  console.log('towns for sale:', f.property.townsForSale.slice(0, 4).map(t => `${t.n} ${t.price}g (bank ${t.bank}g)`).join(' | '));

  // the pages and the reports, in the browser
  const { chromium } = require(path.join(__dirname, '../server/node_modules/playwright'));
  const b = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {});
  const p = await (await b.newContext({ viewport:{ width:1440, height:1500 } })).newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('https://**', r => r.abort());
  await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel","finance"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} });
  await p.goto('file://' + path.resolve(__dirname, '../app/earthmc-ruin-scanner.html') + '#markets');
  await p.waitForFunction(() => typeof appReady !== 'undefined'); await p.evaluate(() => appReady);
  await p.evaluate(([scan, fin]) => { hydrate(scan); FIN = fin; enterApp(); setPage('markets'); }, [A.lastScan, f]);
  const shots = path.join(process.env.DATA_DIR, 'shots'); fs.mkdirSync(shots, { recursive:true });
  for (const pg of ['markets', 'property', 'flows']) {
    await p.evaluate(pg => { location.hash = '#' + pg; }, pg); await p.waitForTimeout(1500);
    await p.screenshot({ path:path.join(shots, pg + '.png') });
    // the panels below the map
    await p.evaluate(() => document.querySelector('section.only-' + document.body.dataset.page).scrollIntoView());
    await p.waitForTimeout(400); await p.screenshot({ path:path.join(shots, pg + '-panels.png') });
    await p.evaluate(() => scrollTo(0, 0));
  }
  console.log('screenshots:', shots);
  console.log('ticker items:', await p.evaluate(() => document.querySelectorAll('#tkTrack .tk-i').length / 2));
  const econ = await p.evaluate(() => {
    const pick = (d, h) => d.sections.filter((x, i, a) => { const hh = a.slice(0, i + 1).reverse().find(y => y.type === 'h'); return hh && hh.text === h && x.type === 'p'; }).map(x => x.text);
    const top = findNation(FIN.nations[0].n);
    return { nation:top ? pick(nationAssessment(top, findNation('Bleeding_Heart'), false), 'Economy').slice(0, 2) : [], intsum:pick(intsum(false), 'Economic Developments') };
  });
  console.log('\nassessment, Economy:\n  ' + econ.nation.join('\n  '));
  console.log('\ndaily summary, Economic Developments:\n  ' + econ.intsum.join('\n  '));
  console.log(errs.join('\n') || 'no errors'); await b.close();
}

(async () => { await synthetic(); if (LIVE) await live(); process.exit(0); })().catch(e => { console.error(e); process.exit(1); });
