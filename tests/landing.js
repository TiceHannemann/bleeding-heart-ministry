const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport:{ width:1440, height:900 } }); await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const now = Date.now(), off = (k, j) => [2, 20 + (k % 25), 35 + (k % 9), 50][j];
  await p.route('https://map.earthmc.net/**', r => r.abort());
  await p.route('https://api.earthmc.net/**', async r => {
    const req = r.request(), u = req.url();
    if (req.method() === 'GET' && u.endsWith('/nations')) return r.fulfill({ status:404, body:'no' });
    if (req.method() === 'GET') return r.fulfill({ json:Array.from({ length:300 }, (_, i) => ({ name:i ? 'Town' + i : 'Bleeding_Heart' })) });
    await new Promise(z => setTimeout(z, 250));
    const q = JSON.parse(req.postData()).query;
    if (u.endsWith('/towns')) return r.fulfill({ json:q.map(n => { const k = n === 'Bleeding_Heart' ? 0 : +n.slice(4);
      return { name:n, mayor:{ name:`R${k}_0` }, nation:{ name:k ? 'N' + k % 5 : 'Bleeding_Heart' }, residents:[0,1,2,3].map(j => ({ name:`R${k}_${j}` })), stats:{ numTownBlocks:20, maxTownBlocks:30, balance:k }, status:{ isPublic:k % 5 == 1, isRuined:k % 23 == 0 && k > 0 }, timestamps:{ registered:now - 100 * 864e5, ruinedAt:now - 3e6 }, coordinates:{ spawn:{ x:(k * 397) % 30000 - 15000, z:(k * 211) % 14000 - 7000 } } }; }) });
    return r.fulfill({ json:q.map(n => { const [k, j] = n.slice(1).split('_').map(Number); return { name:n, timestamps:{ lastOnline:now - off(k, j) * 864e5 } }; }) });
  });
  await p.goto('file://' + require('path').resolve(__dirname, '../app/earthmc-ruin-scanner.html') + '#overclaim');
  await p.waitForSelector('#boot.done', { state:'attached' }); await p.waitForTimeout(900);
  const vis = async s => p.locator(s).first().isVisible();
  console.log('launch: landing', await vis('#landing'), '| header', await vis('header'), '| map', await vis('#mapWrap'), '| nav', await vis('nav.pages'));
  await p.screenshot({ path:'landing.png' });
  await p.click('#scanBig'); await p.waitForTimeout(700);
  console.log('scanning: big button says', await p.textContent('#scanBig'), '| status', (await p.textContent('#landStatus')).slice(0, 50));
  await p.screenshot({ path:'landing-scan.png' });
  for (let i = 0; i < 20; i++) { await p.waitForTimeout(2000); const st = await p.textContent('#landStatus'); const land = await p.evaluate(() => document.body.classList.contains('landing')); console.log(i, land, st.slice(0, 110)); if (!land) break; }
  await p.waitForTimeout(1500);
  console.log('after scan: landing', await vis('#landing'), '| header', await vis('header'), '| map', await vis('#mapWrap'), '| page', await p.textContent('#pageTitle'), '| map size', await p.evaluate(() => [M.W, M.H].join('x')), '| cards', await p.locator('.card').count());
  await p.click('#scan'); await p.waitForTimeout(400);
  console.log('rescan inside app: landing hidden?', !(await vis('#landing')), '| header btn', await p.textContent('#scan'));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
