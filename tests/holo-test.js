const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport:{ width:1440, height:1000 } }); await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const now = Date.now(), off = (k, j) => [0.2, 3 + (k % 25), 35 + (k % 9), 50][j];
  const fig = (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 32" shape-rendering="crispEdges"><rect x="4" y="0" width="8" height="8" fill="#c8946b"/><rect x="4" y="0" width="8" height="3" fill="#3b2412"/><rect x="5" y="4" width="2" height="1" fill="#fff"/><rect x="9" y="4" width="2" height="1" fill="#fff"/><rect x="4" y="8" width="8" height="12" fill="${c}"/><rect x="0" y="8" width="4" height="12" fill="${c}"/><rect x="12" y="8" width="4" height="12" fill="${c}"/><rect x="4" y="20" width="4" height="12" fill="#2b3a67"/><rect x="8" y="20" width="4" height="12" fill="#22305a"/></svg>`;
  await p.route('https://mc-heads.net/**', r => r.fulfill({ contentType:'image/svg+xml', body:r.request().url().includes('/avatar/') ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="#c8946b"/><rect width="8" height="3" fill="#3b2412"/><rect x="1" y="4" width="2" height="1" fill="#fff"/><rect x="5" y="4" width="2" height="1" fill="#fff"/></svg>` : fig('#2aa198') }));
  await p.route('https://minotar.net/**', r => r.abort());
  await p.route('https://map.earthmc.net/**', r => r.abort());
  await p.route('https://api.earthmc.net/**', async r => {
    const req = r.request(), u = req.url();
    if (req.method() === 'GET' && u.endsWith('/nations')) return r.fulfill({ status:404, body:'no' });
    if (req.method() === 'GET') return r.fulfill({ json:Array.from({ length:120 }, (_, i) => ({ name:i ? 'Town' + i : 'Bleeding_Heart' })) });
    const q = JSON.parse(req.postData()).query;
    if (u.endsWith('/towns')) return r.fulfill({ json:q.map(n => { const k = n === 'Bleeding_Heart' ? 0 : +n.slice(4);
      return { name:n, mayor:{ name:`R${k}_0` }, nation:{ name:k ? 'N' + k % 5 : 'Bleeding_Heart' }, residents:Array.from({ length:4 + k % 9 }, (_, j) => ({ name:`R${k}_${j}` })), stats:{ numTownBlocks:20, maxTownBlocks:30, balance:k * 9 }, status:{ isPublic:k % 5 == 1 }, timestamps:{ registered:now - 100 * 864e5 }, coordinates:{ spawn:{ x:(k * 397) % 30000 - 15000, z:(k * 211) % 14000 - 7000 } } }; }) });
    return r.fulfill({ json:q.map(n => { const [k, j] = n.slice(1).split('_').map(Number);
      return { name:n, uuid:'00000000-0000-0000-0000-' + String(k * 100 + j).padStart(12, '0'), title:j === 0 ? 'Lord' : '', surname:j === 0 ? 'the Bold' : '', town:{ name:k ? 'Town' + k : 'Bleeding_Heart' }, nation:{ name:k ? 'N' + k % 5 : 'Bleeding_Heart' },
        status:{ isOnline:j === 1 && k % 2 === 0, isMayor:j === 0, isKing:false }, timestamps:{ registered:now - (300 + k) * 864e5, joinedTownAt:now - (100 + j) * 864e5, lastOnline:now - off(k, j % 4) * 864e5 },
        stats:{ balance:k * 3 + j, numFriends:j * 2 }, ranks:{ townRanks:j === 2 ? ['Councillor'] : [], nationRanks:[] }, about:j === 0 ? 'For the realm.' : '' }; }) });
  });
  await p.goto('file://' + require('path').resolve(__dirname, '../app/earthmc-ruin-scanner.html') + '');
  await p.waitForSelector('#boot.done', { state:'attached' });
  await p.click('#scanBig');
  await p.waitForFunction(() => !document.body.classList.contains('landing'), null, { timeout:120000 });
  await p.waitForTimeout(800);
  console.log('chip:', await p.locator('.pl-chip').first().innerText());
  await p.locator('.pl-chip').first().click(); await p.waitForTimeout(900);
  console.log('card:', (await p.locator('#holoCard .h-info').innerText()).split('\n').slice(0, 14).join(' | '));
  console.log('members:', await p.locator('#holoMembers .h-mem').count());
  await p.mouse.move(820, 420); await p.waitForTimeout(300);
  await p.screenshot({ path:'holo.png' });
  await p.locator('#holoMembers .h-mem').nth(2).click(); await p.waitForTimeout(700);
  console.log('switched to:', await p.locator('.h-name').innerText());
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  console.log('closed:', await p.locator('#holo').isHidden());
  // dossier leader/mayor click
  await p.click('nav a[href="#dossier"]'); await p.waitForTimeout(300);
  await p.locator('details[data-fold="towns"] summary').click(); await p.waitForTimeout(200);
  await p.locator('.dsec .pl-name').first().click(); await p.waitForTimeout(700);
  console.log('from dossier:', await p.locator('.h-name').innerText());
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
