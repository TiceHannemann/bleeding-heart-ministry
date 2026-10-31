const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport:{ width:1440, height:1600 } });
  const p = await ctx.newPage(); await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const NAT = ['Bleeding_Heart', 'Rome', 'Carthage', 'Gaul', 'Persia', 'Sparta', 'Troy', 'Ithaca'], N = 400;
  let round = 0; const ruined = new Set();
  const bank = k => (k * 37) % 900, offset = (k, r) => 36 + ((k * 7 + r * 11) % 10);
  // hidden rule: a town ruins next round if it was within 2 days of the limit and its bank was 450g or less
  const advance = () => { for (let k = 1; k < N; k++) if (!ruined.has(k) && offset(k, round) >= 40 && bank(k) <= 450) ruined.add(k); round++; };
  const now0 = Date.now();
  let feedMode = 'ok';
  await p.route('https://map.earthmc.net/**', r => { const u = r.request().url();
    if (u.includes('/tiles/players.json')) return feedMode === 'ok' ? r.fulfill({ json:{ max:200, players:[{ name:'R1_0', x:-8500, z:100, world:'minecraft_overworld' }, { name:'Wanderer', x:0, z:0, world:'minecraft_overworld' }] }, headers:{ 'access-control-allow-origin':'*' } }) : r.abort();
    return r.abort(); }); await p.route('https://mc-heads.net/**', r => r.abort());
  await p.route('https://api.earthmc.net/**', async r => {
    const req = r.request(), u = req.url(), now = Date.now();
    if (req.method() === 'GET' && u.endsWith('/nations')) return r.fulfill({ json:NAT.map(name => ({ name })) });
    if (req.method() === 'GET') return r.fulfill({ json:Array.from({ length:N }, (_, i) => ({ name:i ? 'Town' + i : 'Bleeding_Heart' })) });
    const q = JSON.parse(req.postData()).query;
    if (u.endsWith('/nations')) return r.fulfill({ json:q.map(name => ({ name, king:{ name:'R' + NAT.indexOf(name) + '_0' }, capital:{ name:'Town' + NAT.indexOf(name) }, allies:[], enemies:name === 'Carthage' ? ['Bleeding_Heart'] : [], stats:{ balance:1000 } })) });
    if (u.endsWith('/towns')) return r.fulfill({ json:q.map(n => { const k = n === 'Bleeding_Heart' ? 0 : +n.slice(4);
      return { name:n, mayor:{ name:`R${k}_0` }, nation:{ name:NAT[k % 8] }, residents:[0, 1].map(j => ({ name:`R${k}_${j}` })), stats:{ numTownBlocks:20, maxTownBlocks:30, balance:bank(k) },
        status:{ isPublic:k % 5 == 1, isRuined:ruined.has(k) }, timestamps:{ registered:now0 - 100 * 864e5, ruinedAt:ruined.has(k) ? now - 3e6 : null }, coordinates:{ spawn:{ x:(k % 8) * 3500 - 12000 + (k * 97) % 1400, z:((k * 53) % 9000) - 4500 } } }; }) });
    return r.fulfill({ json:q.map(n => { const [k, j] = n.slice(1).split('_').map(Number); return { name:n, timestamps:{ lastOnline:now - (k === 0 ? 1 : offset(k, round) + j * 3) * 864e5 } }; }) });
  });
  await p.goto('file://' + require('path').resolve(__dirname, '../app/earthmc-ruin-scanner.html') + '');
  await p.waitForSelector('#boot.done', { state:'attached' });
  const scanOnce = async first => {
    if (first) { await p.click('#scanBig'); await p.waitForFunction(() => !document.body.classList.contains('landing'), null, { timeout:120000 }); }
    else { await p.click('#scan'); await p.waitForFunction(() => /complete/i.test(document.getElementById('status').textContent) && !scanning, null, { timeout:120000 }); }
    await p.waitForFunction(() => ML.open.length > 0, null, { timeout:20000 }); await p.waitForTimeout(1200);
  };

  await scanOnce(true);
  // live path: switch tracking on, the feed is read through fetch
  await p.evaluate(() => { location.hash = '#moves'; }); await p.waitForTimeout(600);
  await p.check('#mvOn'); await p.waitForFunction(() => MOVES.polls > 0, null, { timeout:15000 });
  console.log('live state:', await p.textContent('#mvState'));
  // blocked feed: the relay help appears
  feedMode = 'block'; await p.evaluate(() => pollMoves()); await p.waitForTimeout(800);
  console.log('blocked:', (await p.textContent('#mvState')).slice(0, 90), '| relay box shown:', await p.isVisible('#mvRelay'));
  feedMode = 'ok'; await p.uncheck('#mvOn');
  // scripted scenario, fed straight into the tracker with simulated times 15 s apart
  const out = await p.evaluate(() => {
    moveIndex(); const T = n => towns.find(t => t.name === n);
    const chunksOf = t => [...MOVES.idx].filter(([, v]) => v === t).map(([k]) => k.split(',').map(Number));
    const perimeter = t => chunksOf(t).filter(([x, z]) => onBorder(x, z, t)).map(([x, z]) => [x * 16 + 8, z * 16 + 8]);
    let now = Date.now() - 3 * 3600e3;
    const bg = towns.filter(t => !t.ruined && t.c && !['Town2', 'Town3', 'Town5'].includes(t.name)).slice(0, 80).map(t => ({ name:t.people[0], x:t.c.x + 1, z:t.c.z + 1 }));
    const feed = extra => { now += 15000; ingestMoves({ players:[...bg.map(o => ({ ...o, world:'minecraft_overworld' })), ...extra.map(e => ({ ...e, world:'minecraft_overworld' }))] }, now); };
    const t2 = T('Town2'), t3 = T('Town3'), t5 = T('Town5'), t8 = T('Town8'), t16 = T('Town16'), t24 = T('Town24'), t32 = T('Town32');
    // the scout walks Town8's border, then Town16's, then leaves; the trader warps to Town24's spawn and waits; a passer crosses Town32
    const p8 = perimeter(t8), p16 = perimeter(t16);
    const steps = [];
    for (let i = 0; i < 10; i++) steps.push({ scout:p8[i % p8.length] });
    for (let i = 0; i < 2; i++) steps.push({ scout:[(t8.c.x + t16.c.x) / 2 + 3000, (t8.c.z + t16.c.z) / 2] }); // between towns, in the wild
    for (let i = 0; i < 7; i++) steps.push({ scout:p16[i % p16.length] });
    steps.push({ scout:[t2.c.x, t2.c.z] }, { scout:[t2.c.x + 5, t2.c.z] }, { scout:[t2.c.x + 9, t2.c.z] });
    steps.forEach((st, i) => {
      const ex = [{ name:'R2_0', x:st.scout[0], z:st.scout[1] }];
      ex.push(i < 2 || i > 9 ? { name:'R3_0', x:t3.c.x, z:t3.c.z } : { name:'R3_0', x:t24.spawn.x + (i % 3), z:t24.spawn.z });
      ex.push(i === 5 ? { name:'R5_1', x:t32.c.x, z:t32.c.z } : i === 6 ? { name:'R5_1', x:t32.c.x + 900, z:t32.c.z } : { name:'R5_1', x:t5.c.x, z:t5.c.z });
      feed(ex);
    });
    for (let i = 0; i < 4; i++) feed([]); // everyone else drops off: open visits close
    return { visits:MOVES.visits.map(v => `${v.player}@${v.town}(${v.nation}) ${v.purpose} p=${v.p.toFixed(2)} n=${v.n} edge=${v.edge.toFixed(2)} spawn=${v.spawn.toFixed(2)} warp=${v.warp}`), pairs:movePairs(Date.now() - 86400e3).map(e => `${e.key}: ${e.visits} visits, ${e.recon} recon`) };
  });
  console.log('visits:\n  ' + out.visits.join('\n  ')); console.log('pairs:', out.pairs.join(' | '));
  await p.evaluate(() => renderMoves()); await p.waitForTimeout(300);
  console.log('stats:', (await p.locator('#mvStats').innerText()).replace(/\n/g, ' '));
  console.log('pairs table:', (await p.locator('#mvPairs').innerText()).replace(/\n/g, ' ').slice(0, 220));
  // label: confirm the scout's visits as recon, the trader as trade
  await p.click('[data-mvf="all"]');
  const lab = await p.evaluate(async () => { for (const v of MOVES.visits) { if (v.player === 'R2_0') await labelVisit(v, RECON); if (v.player === 'R3_0') await labelVisit(v, 'Trade'); } const m = mlState().models.scout; return `scout model n=${m.n} hits=${m.hits} edge weight ${ML_MODELS.scout.prior[2]} -> ${m.w[2].toFixed(2)}`; });
  console.log('labels:', lab);
  await p.evaluate(() => { const t8 = towns.find(t => t.name === 'Town8'), t24 = towns.find(t => t.name === 'Town24'), now = Date.now();
    MOVES.every = 15; ingestMoves({ players:[{ name:'R2_0', x:t8.c.x + 3, z:t8.c.z - 9, world:'minecraft_overworld' }, { name:'R3_0', x:t24.spawn.x, z:t24.spawn.z, world:'minecraft_overworld' }] }, now - 30000);
    ingestMoves({ players:[{ name:'R2_0', x:t8.c.x + 6, z:t8.c.z - 12, world:'minecraft_overworld' }, { name:'R3_0', x:t24.spawn.x, z:t24.spawn.z, world:'minecraft_overworld' }] }, now - 15000);
    MOVES.lastOk = now; MOVES.on = true; renderMoves(); frameNation(findNation('Bleeding_Heart')); });
  await p.waitForTimeout(1500);
  console.log('inside now:', (await p.locator('#mvLive').innerText()).replace(/\n/g, ' '));
  await p.screenshot({ path:'moves.png', fullPage:true });
  await p.evaluate(() => { MOVES.on = false; });
  // a scan makes pair forecasts; then a hostile move happens and the forecast is checked
  await p.click('#scan'); await p.waitForFunction(() => /complete/i.test(document.getElementById('status').textContent) && !scanning, null, { timeout:120000 }); await p.waitForTimeout(1500);
  console.log('probe7 open:', await p.evaluate(() => ML.open.filter(p => p.model === 'probe7').map(p => `${p.subject} ${(p.p * 100).toFixed(0)}% towns=${p.towns}`).join(' | ')));
  const res = await p.evaluate(async () => {
    ARCHIVE.events.push({ type:'land', d:-8, ns:['Bleeding_Heart'], town:'Town8', at:Date.now() + 1000 });
    for (const pr of ML.open) if (pr.model === 'probe7') { pr.due = Date.now() - 1; }
    await new Promise(r => setTimeout(r, 1200)); await mlScan();
    const m = mlState().models.probe7; return `probe7 checked n=${m.n} pos=${m.pos}`;
  });
  console.log('outcome:', res);
  // reports
  await p.evaluate(() => { location.hash = '#briefings'; }); await p.waitForTimeout(500);
  await p.click('#brKinds [data-kind="nation"]'); await p.click('.br-class [data-rel="0"]'); await p.selectOption('#brPersp', 'Bleeding_Heart'); await p.locator('#brNations [data-brn="Carthage"]').click(); await p.waitForTimeout(400);
  const mv = await p.locator('.paper p.np', { hasText:'movement collection' }).allInnerTexts();
  console.log('nation report movement paras:', mv.map(x => x.replace(/\n/g, ' ')).join(' // ').slice(0, 900));
  console.log('annex D:', await p.locator('.d-annex', { hasText:'Annex D' }).count());
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#brPdf')]); await dl.saveAs(__dirname + '/mv-nation.pdf');
  await p.click('#brKinds [data-kind="intsum"]'); await p.waitForTimeout(400);
  console.log('intsum movement:', (await p.locator('.paper p.np', { hasText:/movement collection|hostile or wary nations/ }).allInnerTexts()).map(x => x.replace(/\n/g, ' ')).join(' // ').slice(0, 700));
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#brPdf')]); await dl2.saveAs(__dirname + '/mv-intsum.pdf');
  await p.evaluate(() => { location.hash = '#forecasts'; }); await p.waitForTimeout(1200);
  console.log('lab cards:', (await p.locator('.lab-card h3').allInnerTexts()).map(x => x.replace(/\n/g, ' · ')).join(' | '));
  // reload: visits survive in the archive
  await p.reload(); await p.waitForTimeout(2500);
  console.log('after reload visits:', await p.evaluate(() => MOVES.visits.length), '| labelled:', await p.evaluate(() => MOVES.visits.filter(v => v.label).length));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
