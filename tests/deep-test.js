const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport:{ width:1440, height:1500 }, acceptDownloads:true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage(); await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const now = Date.now(), off = (k, j) => [2, 20 + (k % 25), 35 + (k % 9), 50][j];
  const NAT = ['Bleeding_Heart', 'Rome', 'Carthage', 'Gaul', 'Persia', 'Sparta', 'Troy', 'Ithaca'];
  let round = 1;
  const allies = () => ({ Bleeding_Heart:['Rome', 'Gaul'], Rome:['Bleeding_Heart', 'Sparta'], Gaul:['Bleeding_Heart'], Carthage:round > 1 ? ['Persia', 'Troy', 'Sparta'] : ['Persia', 'Troy'], Persia:['Carthage', 'Ithaca'], Sparta:round > 1 ? ['Rome', 'Carthage'] : ['Rome'], Troy:['Carthage'], Ithaca:['Persia'] });
  const enemies = () => ({ Bleeding_Heart:['Carthage'], Carthage:['Bleeding_Heart', 'Rome'], Rome:round > 1 ? ['Carthage', 'Persia', 'Troy'] : ['Carthage', 'Persia'], Persia:['Rome'], Sparta:['Troy'], Troy:['Sparta'], Gaul:[], Ithaca:[] });
  const nationOf = k => round > 1 && k === 4 ? 'Carthage' : NAT[k % 8];
  await p.route('https://map.earthmc.net/**', r => r.abort()); await p.route('https://mc-heads.net/**', r => r.abort());
  await p.route('https://api.earthmc.net/**', async r => {
    const req = r.request(), u = req.url();
    if (req.method() === 'GET' && u.endsWith('/nations')) return r.fulfill({ json:NAT.map(name => ({ name })) });
    if (req.method() === 'GET') return r.fulfill({ json:Array.from({ length:320 }, (_, i) => ({ name:i ? 'Town' + i : 'Bleeding_Heart' })) });
    const q = JSON.parse(req.postData()).query;
    if (u.endsWith('/nations')) { const A = allies(), E = enemies(); return r.fulfill({ json:q.map(name => ({ name, king:{ name:'R' + NAT.indexOf(name) + '_0' }, capital:{ name:'Town' + NAT.indexOf(name) }, allies:A[name].map(n => ({ name:n })), enemies:E[name].map(n => ({ name:n })), stats:{ balance:1000 } })) }); }
    if (u.endsWith('/towns')) return r.fulfill({ json:q.map(n => { const k = n === 'Bleeding_Heart' ? 0 : +n.slice(4); const counted = [0,1,2,3].filter(j => off(k, j) < 42).length;
      const ruined = (k % 23 == 0 && k > 0) || (round > 1 && k % 8 === 2 && k > 0 && k < 60);
      return { name:n, mayor:{ name:`R${k}_0` }, nation:{ name:nationOf(k) }, residents:[0,1,2,3].map(j => ({ name:`R${k}_${j}` })), stats:{ numTownBlocks:14 + (k % 30) + (round > 1 && k % 8 === 1 ? 12 : 0), maxTownBlocks:8 + 8 * counted + 10, balance:(k * 37) % 900 },
        status:{ isPublic:k % 5 == 1, isRuined:ruined }, timestamps:{ registered:now - 100 * 864e5, ruinedAt:ruined ? now - 3e6 : null }, coordinates:{ spawn:{ x:(k % 8) * 3500 - 12000 + (k * 97) % 1400, z:((k * 53) % 9000) - 4500 } } }; }) });
    return r.fulfill({ json:q.map(n => { const [k, j] = n.slice(1).split('_').map(Number); return { name:n, timestamps:{ lastOnline:now - (k === 2 && j === 0 ? 39 : off(k, j)) * 864e5 } }; }) });
  });
  await p.goto('file://' + require('path').resolve(__dirname, '../app/earthmc-ruin-scanner.html') + '');
  await p.waitForSelector('#boot.done', { state:'attached' });
  // seed ten days of history: Carthage shrinking, Rome growing
  await p.evaluate(async ([now]) => {
    await new Promise(r => setTimeout(r, 300));
    const NAT = ['Bleeding_Heart', 'Rome', 'Carthage', 'Gaul', 'Persia', 'Sparta', 'Troy', 'Ithaca'];
    await idbDo(['series', 'meta'], 'readwrite', tx => {
      for (const [ni, n] of NAT.entries()) {
        const pts = Array.from({ length:30 }, (_, i) => { const t = now - (10 - i / 3) * 864e5, k = i / 29;
          const a = n === 'Carthage' ? 80 - 25 * k : n === 'Rome' ? 45 + 12 * k : 50 + ni;
          const c = n === 'Rome' ? 900 + 220 * k : n === 'Carthage' ? 1150 - 60 * k : 1000 + ni * 20;
          return [t, Math.round(a), Math.round(a / 2), 200, 40, Math.round(c), 15000, 2, 2, 0, 0, n === 'Carthage' ? Math.round(3000 - 1500 * k) : 5000, 0, 0]; });
        tx.objectStore('series').put({ name:n, pts }, n);
      }
      tx.objectStore('meta').put({ scans:30, first:now - 10 * 864e5, last:now - 864e5 / 3 }, 'stats');
    });
  }, [now]);
  await p.reload(); await p.waitForSelector('#boot.done', { state:'attached' }); await p.waitForTimeout(500);
  await p.click('#scanBig');
  await p.waitForFunction(() => !document.body.classList.contains('landing'), null, { timeout:120000 }); await p.waitForTimeout(1500);
  round = 2;
  await p.click('#scan'); await p.waitForFunction(() => /complete/i.test(document.getElementById('status').textContent), null, { timeout:120000 }); await p.waitForTimeout(1500);
  console.log('archive:', await p.evaluate(() => `${ARCHIVE.scans} scans, ${ARCHIVE.events.length} events: ` + [...new Set(ARCHIVE.events.map(e => e.type))].join(',')));
  console.log('events sample:', await p.evaluate(() => ARCHIVE.events.slice(0, 6).map(e => eventText(e, e.ns?.[0])).join(' | ')));
  // reload: opens straight into the saved scan
  await p.reload(); await p.waitForTimeout(2500);
  console.log('after reload: landing?', await p.evaluate(() => document.body.classList.contains('landing')), '| towns', await p.evaluate(() => towns.length), '| status:', (await p.textContent('#status')).slice(0, 90));
  // Briefing Room
  await p.evaluate(() => { location.hash = '#briefings'; }); await p.waitForTimeout(800);
  await p.waitForTimeout(800); console.log('INTSUM sections:', (await p.locator('.paper h4').allInnerTexts()).join(' | '));
  await p.screenshot({ path:'br-intsum.png', fullPage:false });
  await p.click('#brKinds [data-kind="nation"]'); await p.waitForTimeout(300);
  await p.locator('#brNations [data-brn="Carthage"]').click(); await p.waitForTimeout(400);
  console.log('Carthage BLUF:', (await p.locator('.paper p').first().innerText()).slice(0, 420));
  console.log('nation sections:', (await p.locator('.paper h4').allInnerTexts()).join(' | '));
  console.log('nation words:', (await p.locator('.paper').innerText()).split(/\s+/).length, '| bullets/kj left:', await p.locator('.paper ul, .d-kj').count());
  await p.screenshot({ path:'br-nation.png', fullPage:false });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#brPdf')]);
  await dl.saveAs(__dirname + '/br-nation.pdf');
  await p.click('.br-class [data-rel="1"]'); await p.waitForTimeout(200);
  console.log('releasable has recommendations?', (await p.locator('.paper h4').allInnerTexts()).some(h => /recommend/i.test(h)));
  // perspective: Persia's view of Rome
  await p.selectOption('#brPersp', 'Persia'); await p.locator('#brNations [data-brn="Rome"]').click(); await p.waitForTimeout(300);
  console.log('perspective memo:', (await p.locator('.d-memo').innerText()).replace(/\n/g, ' ').slice(-140));
  // support assessment for Gaul (ally)
  await p.click('#brKinds [data-kind="support"]'); await p.waitForTimeout(300);
  await p.locator('#brNations [data-brn="Gaul"]').click(); await p.waitForTimeout(300);
  console.log('support sections:', (await p.locator('.paper h4').allInnerTexts()).join(' | '));
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#brPdf')]);
  await dl2.saveAs(__dirname + '/br-support.pdf');
  await p.click('#brKinds [data-kind="intsum"]'); await p.click('.br-class [data-rel="0"]'); await p.waitForTimeout(200);
  const [dl3] = await Promise.all([p.waitForEvent('download'), p.click('#brPdf')]);
  await dl3.saveAs(__dirname + '/br-intsum.pdf');
  // watch mode
  await p.check('#watchOn'); await p.waitForTimeout(1200);
  console.log('watch:', await p.textContent('#watchState'));
  // dossier anticipated moves
  await p.evaluate(() => { location.hash = '#dossier'; }); await p.waitForTimeout(600);
  await p.locator('#natTable tr[data-nation="Carthage"]').click(); await p.waitForTimeout(500);
  console.log('dossier anticipated:', (await p.locator('.dsec', { hasText:'Anticipated moves' }).first().innerText()).replace(/\n/g, ' / ').slice(0, 400));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
