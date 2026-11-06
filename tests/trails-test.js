// Movement history (server/trails.js), without the network: a day of live-map readings replayed at fifteen-second
// steps, then a player's card and the Movement Watch map in the real page against the recorded history.
// Usage: node tests/trails-test.js        (prints "no errors" when everything holds)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), zlib = require('zlib');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-trails-'));
process.env.TRAILS_KEEP_DAYS = '60';
const { chromium } = require(path.join(__dirname, '../server/node_modules/playwright'));
const T = require('../server/trails.js');
const fails = [], check = (ok, what) => { if (!ok) fails.push(what); console.log((ok ? 'ok   ' : 'FAIL ') + what); };

(async () => {
  // a day across the turn of a month: 31 Oct 12:00 to 1 Nov 12:00 UTC, a reading every fifteen seconds
  const t0 = Date.parse('2026-10-31T12:00:00Z'), STEP = 15e3, N = 24 * 240;
  for (let i = 0; i < N; i++) {
    const at = t0 + i * STEP, players = [];
    // Walker walks east at 4 blocks a second for the whole day
    players.push({ name:'Walker', world:'minecraft_overworld', x:i * 60, z:100 });
    // Statue stands still for the first twelve hours, then logs off
    if (i < N / 2) players.push({ name:'Statue', world:'minecraft_overworld', x:500, z:500 });
    // Jumper strolls, teleports 9,000 blocks at the halfway mark, strolls on
    players.push({ name:'Jumper', world:'minecraft_overworld', x:(i < N / 2 ? 0 : 9000) + (i % 240) * 2, z:0 });
    // a Bedrock player (names start with a dot) and someone in the nether (not on the overworld map)
    players.push({ name:'.Bedrock_1', world:'minecraft_overworld', x:-200 - i, z:-200 });
    players.push({ name:'Nether', world:'minecraft_the_nether', x:i, z:i });
    T.record({ players }, at);
  }
  await T.flush();

  const day = [t0 - 1, t0 + N * STEP];
  const w = T.history('Walker', ...day), s = T.history('Statue', ...day), j = T.history('Jumper', ...day), b = T.history('.Bedrock_1', ...day);
  // Walker covers 60 blocks per reading: a point every 30 seconds (two readings) once 64 blocks and 30 s have passed
  check(w.total > 2500 && w.total < 3000, `a walker is kept about every thirty seconds (${w.total} points in a day of ${N} readings)`);
  check(s.total >= 70 && s.total <= 74, `someone standing still is kept every ten minutes (${s.total} points in twelve hours)`);
  const jump = j.points.findIndex((p, i) => i && Math.abs(p[1] - j.points[i - 1][1]) > 5000);
  check(jump > 0 && j.points[jump][0] - j.points[jump - 1][0] <= STEP, 'a teleport keeps where they were just before it and where they landed');
  check(b.total > 0 && fs.existsSync(path.join(T.DIR, '2026-10', '~002eBedrock_1.txt')), "a Bedrock name is stored under a safe file name and read back");
  check(T.history('Nether', ...day).total === 0, 'the nether is not recorded');
  check(fs.existsSync(path.join(T.DIR, '2026-10', 'Walker.txt')) && fs.existsSync(path.join(T.DIR, '2026-11', 'Walker.txt')), 'points go to the month they were seen in');
  const bytes = fs.readdirSync(T.DIR).flatMap(m => fs.readdirSync(path.join(T.DIR, m)).map(f => fs.statSync(path.join(T.DIR, m, f)).size)).reduce((a, x) => a + x, 0);
  console.log(`     a day for these five players takes ${Math.round(bytes / 1024)} KB on disk before compression`);
  check(T.names('wa').includes('Walker') && T.names('.b').includes('.Bedrock_1'), 'names with a history can be looked up as they are typed');
  check(T.history('../etc/passwd', ...day).total === 0, 'a path in place of a name reads nothing');

  // housekeeping: an ended month is compressed, one past keeping is deleted, and both still read back
  fs.mkdirSync(path.join(T.DIR, '2020-01'), { recursive:true }); fs.writeFileSync(path.join(T.DIR, '2020-01', 'Old.txt'), '1577880000,1,1\n');
  T.housekeep();
  check(fs.existsSync(path.join(T.DIR, '2026-10', 'Walker.txt.gz')) && !fs.existsSync(path.join(T.DIR, '2026-10', 'Walker.txt')), 'an ended month is compressed');
  check(!fs.existsSync(path.join(T.DIR, '2020-01')), 'a month past keeping is deleted');
  check(T.history('Walker', ...day).total === w.total, 'compressed months read back the same');
  console.log('     status:', JSON.stringify(T.status()));

  // the page: a player's card shows the path, and the map draws it
  const html = fs.readFileSync(path.join(__dirname, '../app/earthmc-ruin-scanner.html'), 'utf8').replace('<head>', '<head>\n<script>window.BH_SERVER = true;</script>');
  const hist = T.history('Jumper', ...day); hist.points = hist.points.map(p => [p[0] - t0 + Date.now() - N * STEP, p[1], p[2]]); // as if seen in the last day
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/trail')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(/player=Jumper/.test(req.url) ? hist : { name:'Nobody', total:0, thinned:1, points:[] })); }
    if (req.url.startsWith('/api/')) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  }).listen(8795);
  const br = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {});
  const p = await br.newPage({ viewport:{ width:1280, height:900 } }), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https:/, r => r.abort());
  await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} });
  await p.goto('http://127.0.0.1:8795/gov#moves');
  await p.waitForFunction(() => typeof appReady !== 'undefined'); await p.evaluate(() => appReady);
  // two towns under the path, so the card can say where the time went
  await p.evaluate(() => {
    const town = (name, nation, x0) => ({ name, nation:{ name:nation }, mayor:{ name:name + '_m' }, residents:[{ name:name + '_m' }], stats:{ numTownBlocks:30 },
      coordinates:{ spawn:{ x:x0 + 200, z:0 }, homeBlock:[Math.floor((x0 + 200) / 16), 0], townBlocks:Array.from({ length:40 }, (_, i) => [Math.floor(x0 / 16) + i, -1]).concat(Array.from({ length:40 }, (_, i) => [Math.floor(x0 / 16) + i, 0])) }, status:{} });
    hydrate({ details:[town('Westford', 'Westland', 0), town('Eastport', 'Eastland', 9000)], lastOnline:{}, nationDetails:{} });
  });
  await p.evaluate(() => openHolo('Jumper', ''));
  await p.waitForFunction(() => document.querySelector('#holoTrail svg'), null, { timeout:10000 }).catch(() => {});
  const card = await p.evaluate(() => ({ svg:!!document.querySelector('#holoTrail svg polyline'), text:document.querySelector('#holoTrail')?.innerText.replace(/\s+/g, ' ') }));
  check(card.svg, 'the card draws the path');
  check(/Westland/.test(card.text) && /Eastland/.test(card.text), `the card says where the time went: ${card.text}`);
  await p.waitForTimeout(1500); // the card's opening animation
  await p.screenshot({ path:path.join(process.env.DATA_DIR, 'card.png') });
  await p.click('[data-hist-days="1"]'); await p.waitForTimeout(400);
  check(await p.evaluate(() => holoDays === 1 && !!document.querySelector('#holoTrail svg')), 'choosing another span reads it again');
  await p.click('[data-hist-map]'); await p.waitForTimeout(600);
  check(await p.evaluate(() => location.hash === '#moves' && HIST?.name === 'Jumper' && document.querySelector('#holo').hidden !== false), 'the path opens on the Movement Watch map');
  check(await p.evaluate(() => /Jumper's path/.test($('mvState').innerHTML)), 'Movement Watch says whose path it is drawing, and how to hide it');
  await p.evaluate(() => openHolo('Nobody', ''));
  await p.waitForFunction(() => /Not seen/.test(document.querySelector('#holoTrail')?.innerText || ''), null, { timeout:10000 }).catch(() => {});
  check(await p.evaluate(() => /Not seen/.test($('holoTrail').innerText)), 'a player with no record is said not to have been seen, not to have been absent');
  console.log('     card screenshot:', path.join(process.env.DATA_DIR, 'card.png'));
  await br.close(); srv.close();
  console.log(errs.length ? 'page errors: ' + errs.join(' | ') : fails.length ? `${fails.length} failed` : 'no errors');
  process.exit(errs.length || fails.length ? 1 : 0);
})();
