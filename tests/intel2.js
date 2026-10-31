const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport:{ width:1400, height:1600 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage(); await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const now = Date.now(), off = (k, j) => [2, 20 + (k % 25), 35 + (k % 9), 50][j];
  const NAT = ['Bleeding_Heart','Rome','Carthage','Gaul','Persia','Sparta','Troy','Ithaca'];
  const allies = { Bleeding_Heart:['Rome','Gaul'], Rome:['Bleeding_Heart','Sparta'], Gaul:['Bleeding_Heart'], Carthage:['Persia','Troy'], Persia:['Carthage','Ithaca'], Sparta:['Rome'], Troy:['Carthage'], Ithaca:['Persia'] };
  const enemies = { Bleeding_Heart:['Carthage'], Carthage:['Bleeding_Heart','Rome'], Rome:['Carthage','Persia'], Persia:['Rome'], Sparta:['Troy'], Troy:['Sparta'], Gaul:[], Ithaca:[] };
  await p.addInitScript(([now]) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    const NAT = ['Bleeding_Heart','Rome','Carthage','Gaul','Persia','Sparta','Troy','Ithaca'];
    const hist = [6, 4, 2].map((d, i) => ({ at:now - d * 864e5, nations:NAT.map((n, j) => ({ n, a:40 + j * 3 + i * (j === 2 ? -4 : 3), r:120, t:30, c:900 + j * 40 + i * 20, g:15000, al:1, en:1 })) }));
    localStorage.setItem('rh_history', JSON.stringify(hist));
  }, [now]);
  await p.route('https://api.earthmc.net/**', async r => {
    const req = r.request(), u = req.url();
    if (req.method() === 'GET' && u.endsWith('/nations')) return r.fulfill({ json:NAT.map(name => ({ name })) });
    if (req.method() === 'GET') return r.fulfill({ json:Array.from({ length:320 }, (_, i) => ({ name:'Town' + i })) });
    const q = JSON.parse(req.postData()).query;
    if (u.endsWith('/nations')) return r.fulfill({ json:q.map(name => ({ name, king:{ name:'R' + NAT.indexOf(name) + '_0' }, capital:{ name:'Town' + NAT.indexOf(name) }, allies:allies[name].map(n => ({ name:n })), enemies:enemies[name].map(n => ({ name:n })), stats:{ balance:1000 } })) });
    if (u.endsWith('/towns')) return r.fulfill({ json:q.map(n => { const k = +n.slice(4); const counted = [0,1,2,3].filter(j => off(k, j) < 42).length;
      return { name:n, mayor:{ name:`R${k}_0` }, nation:{ name:NAT[k % 8] }, residents:[0,1,2,3].map(j => ({ name:`R${k}_${j}` })), stats:{ numTownBlocks:14 + (k % 30), maxTownBlocks:8 + 8 * counted + 10, balance:(k * 37) % 900 },
        status:{ isPublic:k % 5 == 1, isRuined:k % 23 == 0 && k > 0 }, timestamps:{ registered:now - 100 * 864e5, ruinedAt:k % 23 == 0 ? now - 3e6 : null }, coordinates:{ spawn:{ x:(k * 397) % 30000 - 15000, z:(k * 211) % 14000 - 7000 } } }; }) });
    return r.fulfill({ json:q.map(n => { const [k, j] = n.slice(1).split('_').map(Number); return { name:n, timestamps:{ lastOnline:now - off(k, j) * 864e5 } }; }) });
  });
  await p.goto('file://' + require('path').resolve(__dirname, '../app/earthmc-ruin-scanner.html') + '#dossier');
  await p.waitForSelector('#boot.done', { state:'attached' });
  await p.route('https://map.earthmc.net/**', r => r.abort()); await p.route('https://mc-heads.net/**', r => r.abort()); await p.click('#scanBig');
  await p.waitForFunction(() => /complete|paused/i.test(document.getElementById('status').textContent), null, { timeout:200000 });
  await p.waitForTimeout(500);
  await p.waitForTimeout(800);
  console.log('page:', await p.textContent('#pageTitle'), '| ministry:', await p.textContent('#sysMinistry'), '| map visible:', await p.locator('#mapWrap').isVisible(), '| target panel hidden:', !(await p.locator('#target').isVisible()));
  console.log('rank rows:', (await p.locator('#natTable tr[data-nation]').allInnerTexts()).map(x => x.replace(/\s+/g, ' ')).join(' || '));
  await p.locator('#natTable tr[data-nation="Carthage"]').click(); await p.waitForTimeout(1200);
  console.log('tags:', await p.locator('.a-tags').innerText());
  console.log('brief:', await p.locator('.brief').innerText());
  console.log('meters:', (await p.locator('.meters').innerText()).replace(/\n/g, ' '));
  await p.selectOption('#natSort', 'hostility'); await p.waitForTimeout(200);
  console.log('most hostile first:', (await p.locator('#natTable tr[data-nation]').first().innerText()).replace(/\s+/g, ' '));
  await p.locator('#mapWrap').screenshot({ path:'intel-map-stance.png' });
  await p.click('[data-lens="risk"]'); await p.waitForTimeout(400);
  await p.locator('#mapWrap').screenshot({ path:'intel-map-risk.png' });
  // click a town on the map -> selects its nation
  const hit = await p.evaluate(() => { const h = M.hits.find(h => h.t.nation === 'Persia'); return h && { x:h.x / M.dpr, y:h.y / M.dpr }; });
  if (hit) { const box = await p.locator('#map').boundingBox(); await p.mouse.click(box.x + hit.x, box.y + hit.y); await p.waitForTimeout(600); console.log('map click selects:', await p.locator('.dname').innerText()); }
  await p.locator('[data-copybrief]').click(); await p.waitForTimeout(200);
  console.log('copied brief:', JSON.stringify((await p.evaluate(() => navigator.clipboard.readText())).slice(0, 220)));
  await p.locator('.assess').scrollIntoViewIfNeeded(); await p.screenshot({ path:'intel-dossier2.png' });
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout:5000 }).catch(() => null), p.evaluate(() => sendToWarRoom())]);
  const pkg = JSON.parse(await p.evaluate(() => navigator.clipboard.readText()));
  console.log('package nation fields:', Object.keys(pkg.nations.find(n => n.n === 'Carthage')).join(','), '| sm chars', pkg.nations.find(n => n.n === 'Carthage').sm.length);
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
