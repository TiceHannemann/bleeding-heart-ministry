// End-to-end test of the hosted server: hourly collector against a fake EarthMC API, server-side sign-in,
// archive sync into a visitor's browser, and the hourly reports page.
// Run from the project folder:  cd server && npm install && cd .. && node tests/server-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require(path.join(__dirname, '../server/node_modules/playwright'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-srv-'));
process.env.PORT = '8799'; process.env.INSECURE_COOKIE = '1'; const OPEN = process.argv.includes('--open'); // --open: no password, the site is open to everyone
if (!OPEN) process.env.MINISTRY_PASSWORD = 'test-pass';

const now = Date.now(), off = (k, j) => [2, 20 + (k % 25), 35 + (k % 9), 50][j];
const NAT = ['Bleeding_Heart', 'Rome', 'Carthage', 'Gaul', 'Persia', 'Sparta', 'Troy', 'Ithaca'];
const A = { Bleeding_Heart:['Rome', 'Gaul'], Rome:['Bleeding_Heart', 'Sparta'], Gaul:['Bleeding_Heart'], Carthage:['Persia', 'Troy'], Persia:['Carthage', 'Ithaca'], Sparta:['Rome'], Troy:['Carthage'], Ithaca:['Persia'] };
const E = { Bleeding_Heart:['Carthage'], Carthage:['Bleeding_Heart', 'Rome'], Rome:['Carthage', 'Persia'], Persia:['Rome'], Sparta:['Troy'], Troy:['Sparta'], Gaul:[], Ithaca:[] };
let apiCalls = 0;
global.__collectorRoutes = async ctx => {
  await ctx.route('https://map.earthmc.net/**', r => r.abort());
  await ctx.route('https://api.earthmc.net/**', async r => {
    apiCalls++;
    const req = r.request(), u = req.url();
    if (req.method() === 'GET' && u.endsWith('/nations')) return r.fulfill({ json:NAT.map(name => ({ name })) });
    if (req.method() === 'GET') return r.fulfill({ json:Array.from({ length:200 }, (_, i) => ({ name:i ? 'Town' + i : 'Bleeding_Heart' })) });
    const q = JSON.parse(req.postData()).query;
    if (u.endsWith('/nations')) return r.fulfill({ json:q.map(name => ({ name, king:{ name:'R' + NAT.indexOf(name) + '_0' }, capital:{ name:'Town' + NAT.indexOf(name) }, allies:A[name].map(n => ({ name:n })), enemies:E[name].map(n => ({ name:n })), stats:{ balance:1000 } })) });
    if (u.endsWith('/towns')) return r.fulfill({ json:q.map(n => { const k = n === 'Bleeding_Heart' ? 0 : +n.slice(4); const counted = [0, 1, 2, 3].filter(j => off(k, j) < 42).length;
      return { name:n, mayor:{ name:`R${k}_0` }, nation:{ name:NAT[k % 8] }, residents:[0, 1, 2, 3].map(j => ({ name:`R${k}_${j}` })), stats:{ numTownBlocks:14 + (k % 30), maxTownBlocks:8 + 8 * counted + 10, balance:(k * 37) % 900 },
        status:{ isPublic:k % 5 == 1, isRuined:k % 23 == 0 && k > 0 }, timestamps:{ registered:now - 100 * 864e5 }, coordinates:{ spawn:{ x:(k % 8) * 3500 - 12000, z:((k * 53) % 9000) - 4500 } } }; }) });
    return r.fulfill({ json:q.map(n => { const [k, j] = n.slice(1).split('_').map(Number); return { name:n, timestamps:{ lastOnline:now - off(k, j) * 864e5 } }; }) });
  });
};

(async () => {
  require('../server/server.js');
  const collector = require('../server/collector.js');
  const t0 = Date.now();
  while (!collector.status().lastOk && !collector.status().lastError && Date.now() - t0 < 10 * 6e4) await new Promise(r => setTimeout(r, 2000));
  const st = collector.status();
  console.log('collector:', st.lastOk ? 'ok' : 'FAILED ' + st.lastError, '| api calls', apiCalls);
  const runs = fs.readdirSync(path.join(process.env.DATA_DIR, 'runs'));
  const files = fs.readdirSync(path.join(process.env.DATA_DIR, 'runs', runs[0]));
  console.log('run files:', files.join(', '));

  const b = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}), p = await (await b.newContext()).newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('https://**', r => r.abort());
  const base = 'http://127.0.0.1:8799';
  console.log('archive without sign-in:', (await p.goto(base + '/api/archive')).status());
  if (OPEN) {
    console.log('import refused when open:', (await p.request.post(base + '/api/import', { data:'{"kind":"bleeding-heart-archive"}' })).status());
    console.log('scan-now cooldown:', (await p.request.post(base + '/api/scan-now')).status());
    await p.goto(base + '/gov'); console.log('gov opens directly:', new URL(p.url()).pathname);
  } else {
    await p.goto(base + '/gov'); console.log('gov redirects to:', new URL(p.url()).pathname);
    await p.fill('#pw', 'wrong'); await p.click('button'); console.log('wrong password:', /Incorrect/.test(await p.textContent('.e')));
    await p.fill('#pw', 'test-pass'); await p.click('button'); await p.waitForURL(/\/gov/);
  }
  // first load pulls the server's archive and reloads into it
  await p.waitForFunction(() => typeof towns !== 'undefined' && towns.length > 0, null, { timeout:60000 });
  console.log('visitor sees:', await p.evaluate(() => `${towns.length} towns, ${nations.length} nations, ${ARCHIVE.scans} scans, ML made ${mlState().made}`));
  console.log('hourly link in nav:', await p.locator('nav.pages [data-hourly]').count());
  await p.goto(base + '/gov/reports');
  console.log('reports listed:', (await p.locator('ol li').allInnerTexts()).map(t => t.split('\n')[0]).join(' | '));
  const pdf = await p.request.get(base + '/reports/latest/intsum.pdf');
  console.log('intsum pdf:', pdf.status(), (await pdf.body()).slice(0, 8).toString());
  console.log('public site link:', await (await p.request.get(base + '/')).text().then(t => t.includes('href="/gov"')));
  console.log(errs.join('\n') || 'no errors');
  await b.close(); process.exit(0);
})();
