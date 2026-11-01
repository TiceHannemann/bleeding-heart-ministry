// End-to-end test of the hosted server: hourly collector against a fake EarthMC API, server-side sign-in,
// archive sync into a visitor's browser, and the hourly reports page.
// Run from the project folder:  cd server && npm install && cd .. && node tests/server-test.js
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require(path.join(__dirname, '../server/node_modules/playwright'));
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-srv-'));
process.env.PORT = '8799'; process.env.INSECURE_COOKIE = '1'; process.env.FINANCE_DEEP = 'off'; const OPEN = process.argv.includes('--open'); // --open: no password, the site is open to everyone
if (!OPEN) process.env.MINISTRY_PASSWORD = 'test-pass';

const now = Date.now(), off = (k, j) => [2, 20 + (k % 25), 35 + (k % 9), 50][j];
const NAT = ['Bleeding_Heart', 'Rome', 'Carthage', 'Gaul', 'Persia', 'Sparta', 'Troy', 'Ithaca'];
const A = { Bleeding_Heart:['Rome', 'Gaul'], Rome:['Bleeding_Heart', 'Sparta'], Gaul:['Bleeding_Heart'], Carthage:['Persia', 'Troy'], Persia:['Carthage', 'Ithaca'], Sparta:['Rome'], Troy:['Carthage'], Ithaca:['Persia'] };
const E = { Bleeding_Heart:['Carthage'], Carthage:['Bleeding_Heart', 'Rome'], Rome:['Carthage', 'Persia'], Persia:['Rome'], Sparta:['Troy'], Troy:['Sparta'], Gaul:[], Ithaca:[] };
let apiCalls = 0;
// a fake live map: one Rome player stands at the spawn of the Kingdom's capital for a while, then logs off
let feedOn = true, feedHits = 0;
require('http').createServer((req, res) => { feedHits++; res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ players:feedOn ? [{ name:'R1_1', x:-12000, z:-4500, world:'minecraft_overworld' }] : [] })); }).listen(8797);
process.env.PLAYERS_FEED = 'http://127.0.0.1:8797/players.json';

// a fake of what an EarthMC API key unlocks: leaderboards, pursuits, the key owner's shops, skills and books, and the event stream
const KEY = 'test-key', seen = { auth:0, bodyKey:0, cool:0, boards:0 };
const pid = (k, j) => `00000000-0000-4000-8000-${String(k * 10 + j).padStart(12, '0')}`, tid = k => `00000000-0000-4000-9000-${String(k).padStart(12, '0')}`;
const townOf = k => k ? 'Town' + k : 'Bleeding_Heart';
const player = (k, j) => ({ name:`R${k}_${j}`, uuid:pid(k, j), town:{ name:townOf(k) }, nation:{ name:NAT[k % 8] } });
const ME = { name:'Me', uuid:'00000000-0000-4000-8000-999999999999', town:{ name:'Town3' }, nation:{ name:NAT[3] } };
require('http').createServer((req, res) => {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type':type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  if (req.url.startsWith('/events')) {
    if (req.headers.authorization !== 'Bearer ' + KEY) return send(401, 'Unauthorized', 'text/plain');
    seen.auth++;
    res.writeHead(200, { 'Content-Type':'text/event-stream' });
    const ev = (name, d) => res.write(`event: ${name}\ndata: ${JSON.stringify(d)}\n\n`), now = () => Math.floor(Date.now() / 1000);
    ev('open', { message:'Connected to the EarthMC API.' }); ev('listening', { valid:['NewDay'], invalid:[] });
    const keep = setInterval(() => res.write(': keepalive\n\n'), 5000);
    setTimeout(() => {
      ev('ShopSoldItem', { shop:{ item:'minecraft:diamond', price:40, amount:4, type:'selling', stock:8, location:{ x:-11900, y:64, z:-4400 } }, buyer:'R1_1', timestamp:now() });
      ev('ShopOutOfStock', { action:'out_of_stock', shop:{ item:'OAK_LOG', price:5, amount:64, type:'selling', stock:0, location:{ x:-11950, y:64, z:-4420 } }, timestamp:now() });
      ev('ResidentJoinedTown', { town:{ name:'Town3', uuid:tid(3) }, resident:{ name:'R5_2', uuid:pid(5, 2) }, timestamp:now() });
    }, 2000);
    const nd = setTimeout(() => ev('NewDay', { timestamp:now() }), 40000);
    req.on('close', () => { clearInterval(keep); clearTimeout(nd); });
    return;
  }
  let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    const b = raw ? JSON.parse(raw) : {}, q = b.query, u = req.url;
    if (b.key === KEY) seen.bodyKey++;
    const keyed = ['/mcmmo-top', '/pursuits', '/shop', '/mcmmo'].includes(u);
    if (keyed && b.key !== KEY) return send(401, 'Invalid API key', 'text/plain');
    if (u === '/mcmmo-top') {
      if (++seen.boards === 3) { seen.cool++; return send(429, 'Too Many Requests. Try again in 2 second(s)', 'text/plain'); }
      const si = ['power', 'SWORDS', 'AXES', 'ARCHERY', 'CROSSBOWS', 'MACES', 'SPEARS', 'TRIDENTS', 'UNARMED', 'ACROBATICS', 'TAMING', 'MINING'].indexOf(q) + 1 || 13;
      const top = { skill:q, lastUpdated:Math.floor(Date.now() / 1000) };
      // Rome's R1 players lead the combat boards; the rest are spread over the other nations
      for (let r = 0; r < 25; r++) { const k = r < 3 ? 1 : ((si * 7 + r * 13 + seen.boards) % 199) + 1; top[r + 1] = { player:`R${k}_${r % 4}`, level:1000 - r * 30 - si }; }
      return send(200, [top]);
    }
    if (u === '/pursuits') return send(200, [{ PLAYER:{ name:'ores-mined', isActive:true, top:{ 1:{ player:pid(2, 1), score:5278 }, 2:{ player:pid(6, 0), score:4100 } } },
      TOWN:{ name:'residents-recruited', isActive:true, top:{ 1:{ town:tid(9), score:3 } } }, NATION:{ name:'koth-points', isActive:true, top:{} } }]);
    if (u === '/shop') return send(200, q[0] === ME.uuid ? [{ 0:{ item:'minecraft:diamond', price:40, amount:4, type:'selling', stock:8, location:{ x:-11900, y:64, z:-4400 } },
      1:{ item:'OAK_LOG', price:5, amount:64, type:'selling', stock:0, location:{ x:-11950, y:64, z:-4420 } } }] : []);
    if (u === '/mcmmo') return send(200, [{ name:'Me', SWORDS:950, AXES:400, MINING:300, ARCHERY:120 }]);
    if (u === '/players') return send(200, q.map(n => n === 'Me' || n === ME.uuid ? ME : /^R\d+_\d+$/.test(n) ? player(...n.slice(1).split('_').map(Number)) : n.startsWith('00000000-0000-4000-8000-') ? player(Math.floor(+n.slice(-12) / 10), +n.slice(-12) % 10) : null).filter(Boolean));
    if (u === '/towns') return send(200, q.map(n => n.startsWith('00000000') ? { name:townOf(+n.slice(-12)), uuid:n, nation:{ name:NAT[+n.slice(-12) % 8] } }
      : { name:n, stats:{ balance:487.5 }, bankhistory:b.key === KEY && n === 'Town3' ? [{ timestamp:Math.floor(Date.now() / 1000) - 7200, amount:25, balance:500, reason:'Deposit by Me' }, { timestamp:Math.floor(Date.now() / 1000) - 3600, amount:-12.5, balance:487.5, reason:'Town upkeep' }] : [] }));
    if (u === '/nations') return send(200, q.map(n => ({ name:n, stats:{ balance:1000 }, bankhistory:[] })));
    send(404, 'Not found', 'text/plain');
  });
}).listen(8796);
Object.assign(process.env, { EMC_API:'http://127.0.0.1:8796', EMC_KEY:KEY, EMC_PLAYER:'Me', KEYED_EVERY:'2', NEWDAY_DELAY_S:'5' });
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
  // positions are recorded between scans: let the player stand there, leave, then export with a second scan
  await new Promise(r => setTimeout(r, 35000)); feedOn = false; await new Promise(r => setTimeout(r, 60000));
  while (collector.status().running) await new Promise(r => setTimeout(r, 1000)); // the new-day scan may be under way
  await collector.runOnce();
  console.log('feed polls:', feedHits, '| second scan:', collector.status().lastError || 'ok');
  const ks = collector.status().keyed;
  console.log('key:', `${ks.boards} boards, live stream ${ks.live}, ${ks.events} events, errors ${JSON.stringify(ks.errs)}`, '| stream auth', seen.auth, '| key in bodies', seen.bodyKey, '| cooldowns honoured', seen.cool);
  console.log('new-day scan ran:', !!collector.status().newDayScan, '| scans so far', collector.status().recent.length);
  const leaks = [JSON.stringify(collector.status()), require('zlib').gunzipSync(fs.readFileSync(path.join(process.env.DATA_DIR, 'archive.json.gz'))).toString(), fs.readFileSync(path.join(process.env.DATA_DIR, 'keyed', 'state.json'), 'utf8')];
  console.log('key leaked into status/archive/state:', leaks.map(t => t.includes(KEY)).join('/'));
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
  console.log('recorded visits:', await p.evaluate(() => MOVES.visits.map(v => `${v.player} of ${v.pn} in ${v.town} (${v.purpose})`).join('; ') || 'none'));
  const shot = name => p.screenshot({ path:path.join(process.env.DATA_DIR, name + '.png') });
  console.log('ministry picker shown:', await p.evaluate(() => document.body.classList.contains('portal')), '| buttons:', (await p.locator('.p-dept').allInnerTexts()).join(', '));
  await shot('picker');
  await p.click('[data-ministry="intel"]'); await p.waitForTimeout(800);
  console.log('picked intel, password asked:', await p.evaluate(() => !document.getElementById('gate').hidden), '| in ministry:', await p.evaluate(() => !document.body.classList.contains('portal')));
  await p.waitForSelector('#boot.done', { state:'attached', timeout:15000 }).catch(() => {}); await p.waitForTimeout(1500);
  console.log('straight into the ministry:', await p.evaluate(() => !document.body.classList.contains('landing')), '| scan buttons visible:', await p.isVisible('#scanBig'), await p.isVisible('#scan'));
  console.log('nav shows only intel pages:', await p.evaluate(() => [...document.querySelectorAll('nav.pages a')].filter(a => a.offsetParent).map(a => a.dataset.tip).join(', ')));
  await p.hover('nav.pages a[href="#moves"]'); await p.waitForTimeout(300); await shot('intel');
  // Rankings: the leaderboards and pursuits from the API key
  await p.evaluate(() => { location.hash = '#rankings'; }); await p.waitForTimeout(1200);
  console.log('rankings:', await p.evaluate(() => `${Object.keys(KEYED.boards).length} boards, top nation ${fighting()[0]?.n}, me ${KEYED.me?.name}`), '| stats:', (await p.textContent('#rkStats')).replace(/\s+/g, ' '));
  console.log('power board rows:', await p.locator('#rkBoard tr').count() - 1, '| you on it:', await p.locator('#rkBoard .rk-me').count(), '| pursuits:', (await p.textContent('#rkPursuits')).replace(/\s+/g, ' ').slice(0, 140));
  await p.click('[data-rkskill="SWORDS"]'); await p.waitForTimeout(300);
  console.log('swords board title:', await p.textContent('#rkBoardH'), '| first row:', (await p.locator('#rkBoard tr').nth(1).innerText()).replace(/\s+/g, ' '));
  await shot('rankings');
  console.log('assessment names fighters:', await p.evaluate(() => /combat leaderboards/.test(docText(nationAssessment(findNation('Rome'), null, false)))), '| summary section:', await p.evaluate(() => /FIGHTING STRENGTH|Fighting Strength/.test(docText(intsum(false)))));
  await p.click('#rkNations tr[data-rknat="Rome"]'); await p.waitForTimeout(1200);
  console.log('nation click opens dossier:', await p.evaluate(() => location.hash + ' ' + selNation), '| fighters tile:', (await p.locator('#dossierPanel .dtile').first().innerText()).replace(/\s+/g, ' '));
  await p.click('.m-switch a[data-m="finance"]'); await p.waitForTimeout(1200);
  console.log('switched to finance:', await p.evaluate(() => document.body.dataset.m + ' / ' + document.body.dataset.page), '| visible nav:', await p.evaluate(() => [...document.querySelectorAll('nav.pages a')].filter(a => a.offsetParent).map(a => a.dataset.tip).join(', ')));
  await shot('finance');
  // Ledger: the key owner's shops, trades, books and notices
  await p.evaluate(() => { location.hash = '#ledger'; }); await p.waitForTimeout(1200);
  console.log('ledger icon shown:', await p.isVisible('nav.pages a[href="#ledger"]'), '| shops', await p.locator('#lgShops tr').count() - 1, '| trades:', (await p.textContent('#lgTrades')).replace(/\s+/g, ' ').slice(0, 120));
  console.log('ledger books:', (await p.textContent('#lgBank')).replace(/\s+/g, ' ').slice(0, 120), '| notices:', (await p.textContent('#lgNotices')).replace(/\s+/g, ' ').slice(0, 80), '| stats:', (await p.textContent('#finStats')).replace(/\s+/g, ' '));
  await shot('ledger');
  await p.click('.m-switch a[data-m="attack"]'); await p.waitForTimeout(1200); await shot('attack');
  console.log('purge countdown:', await p.textContent('#sysPurge'), '| new day known:', await p.evaluate(() => !!KEYED?.newDayAt));
  await p.click('.sysbar .crest'); await p.waitForTimeout(500);
  console.log('crest returns to picker:', await p.evaluate(() => document.body.classList.contains('portal')));
  await p.click('[data-ministry="intel"]'); await p.waitForTimeout(800);
  console.log('screenshots in:', process.env.DATA_DIR);
  console.log('checkboxes left:', await p.locator('#watchOn, #mvOn').count(), '| auto-scan says:', await p.textContent('#watchState'));
  await p.evaluate(() => { location.hash = '#moves'; }); await p.waitForTimeout(16000);
  console.log('visitor live feed:', await p.evaluate(() => MOVES.lastOk > 0 ? `ok, ${MOVES.online} online` : 'none: ' + MOVES.err));
  console.log('hourly link in nav:', await p.locator('nav.pages [data-hourly]').count());
  await p.goto(base + '/gov/reports');
  console.log('reports listed:', (await p.locator('ol li').allInnerTexts()).map(t => t.split('\n')[0]).join(' | '));
  const pdf = await p.request.get(base + '/reports/latest/intsum.pdf');
  console.log('intsum pdf:', pdf.status(), (await pdf.body()).slice(0, 8).toString());
  console.log('home page is the ministries:', await (await p.request.get(base + '/')).text().then(t => t.includes('MINISTRY_HOME') || /\/login/.test(t)));
  console.log(errs.join('\n') || 'no errors');
  await b.close(); await collector.closeBrowser(); process.exit(0);
})();
