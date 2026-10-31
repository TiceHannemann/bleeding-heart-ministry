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
  await p.route('https://map.earthmc.net/**', r => r.abort()); await p.route('https://mc-heads.net/**', r => r.abort());
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
  for (let i = 0; i < 6; i++) {
    await scanOnce(i === 0);
    const info = await p.evaluate(() => { const m = mlState().models; return Object.entries(m).map(([k, v]) => `${k}:${v.n}`).join(' ') + ` | open ${ML.open.length}`; });
    console.log(`after scan ${i + 1}:`, info);
    // move every open forecast's window into the past, then let the world move on
    await p.evaluate(() => { for (const pr of ML.open) { pr.at -= 8 * 864e5; pr.due -= 8 * 864e5; } });
    advance();
  }
  const res = await p.evaluate(() => { const m = mlState().models.ruin72, M = ML_MODELS.ruin72;
    return { n:m.n, pos:m.pos, brier:(m.sse / m.n).toFixed(3), brierRules:(m.sse0 / m.n).toFixed(3), skill:Math.round((1 - m.sse / m.sse0) * 100) + '%', acc:Math.round(m.hits / m.n * 100) + '% vs rules ' + Math.round(m.hits0 / m.n * 100) + '%',
      bankWeight:M.prior[8] + ' -> ' + m.w[8].toFixed(2), learned:learnedNotes('ruin72', m) }; });
  console.log('ruin72:', JSON.stringify(res));
  await p.evaluate(() => { location.hash = '#forecasts'; }); await p.waitForTimeout(1500);
  console.log('lab summary:', (await p.locator('#labSum').innerText()).replace(/\n/g, ' '));
  await p.screenshot({ path:'lab.png', fullPage:false });
  await p.evaluate(() => { location.hash = '#briefings'; }); await p.waitForTimeout(500);
  await p.click('#brKinds [data-kind="intsum"]'); await p.waitForTimeout(500);
  console.log('INTSUM forecast lines:', (await p.locator('.paper p').allInnerTexts()).filter(l => /Forecast Lab|its models/.test(l)).join(' || ').slice(0, 500));
  await p.click('#brKinds [data-kind="nation"]'); await p.locator('#brNations [data-brn="Carthage"]').click(); await p.waitForTimeout(400);
  console.log('KJ:', (await p.locator('.paper p.np', { hasText:'The Ministry judges' }).allInnerTexts()).join(' / ').slice(0, 600));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
