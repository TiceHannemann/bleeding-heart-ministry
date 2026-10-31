const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport:{ width:1440, height:900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
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

  await p.goto('file://' + require('path').resolve(__dirname, '../app/earthmc-ruin-scanner.html') + ''); await p.waitForTimeout(800);
  const vis = sel => p.isVisible(sel);
  console.log('opens on portal:', await vis('#portal'), '| landing visible:', await vis('#landScan, #scanBig'), '| boot hidden:', await p.evaluate(() => document.getElementById('boot').classList.contains('done')));
  await p.screenshot({ path:'portal-top.png' });
  console.log('ministry buttons:', (await p.locator('#portal .p-dept').allInnerTexts()).join(', '), '| clock', await p.textContent('#sClock'));
  // wrong, then right
  await p.click('[data-ministry="intel"]'); await p.waitForTimeout(200);
  console.log('gate:', await p.textContent('#gateTitle'), '| visible', await vis('#gate'));
  await p.fill('#gatePw', 'letmein'); await p.click('.g-go'); await p.waitForTimeout(450);
  console.log('wrong:', await p.textContent('#gateErr'), '| still on portal:', await vis('#portal'));
  await p.screenshot({ path:'portal-gate.png' });
  await p.fill('#gatePw', process.env.BH_GATE_PASSWORD); await p.press('#gatePw', 'Enter'); await p.waitForTimeout(500);
  console.log('right: portal gone', !(await vis('#portal')), '| boot playing', await p.evaluate(() => !document.getElementById('boot').classList.contains('done')), '| hash', await p.evaluate(() => location.hash));
  await p.waitForFunction(() => document.getElementById('boot').classList.contains('done'), null, { timeout:6000 }); await p.waitForTimeout(700);
  console.log('landing:', (await p.textContent('#landTitle')).trim(), '| descriptions shown:', await p.isVisible('#landLede') || await p.isVisible('#landMods'));
  await p.screenshot({ path:'portal-intel-landing.png' });
  // crossing into the other ministry asks again
  await p.evaluate(() => { location.hash = '#overclaim'; }); await p.waitForTimeout(300);
  console.log('cross to attack: gate', await vis('#gate'), await p.textContent('#gateTitle'), '| hash held at', await p.evaluate(() => location.hash));
  await p.click('#gateCancel'); await p.waitForTimeout(200);
  console.log('cancel: gate', await vis('#gate'), '| hash', await p.evaluate(() => location.hash), '| title', (await p.textContent('#landTitle')).trim());
  await p.evaluate(() => { location.hash = '#overclaim'; }); await p.waitForTimeout(200);
  await p.fill('#gatePw', process.env.BH_GATE_PASSWORD); await p.press('#gatePw', 'Enter'); await p.waitForTimeout(300);
  console.log('enter attack: hash', await p.evaluate(() => location.hash), '| title', (await p.textContent('#landTitle')).trim(), '| unlocked', await p.evaluate(() => sessionStorage.getItem('bh_unlocked')));
  // scan and into the app
  await p.click('#scanBig'); await p.waitForFunction(() => !document.body.classList.contains('landing'), null, { timeout:120000 }); await p.waitForTimeout(1500);
  console.log('in app, page:', await p.textContent('#pageTitle'), '| lock button', await vis('#lockBtn'));
  await p.click('#lockBtn'); await p.waitForTimeout(400);
  console.log('locked: portal', await vis('#portal'), '| unlocked', await p.evaluate(() => sessionStorage.getItem('bh_unlocked')), '| scanned towns', await p.evaluate(() => towns.length));
  await p.evaluate(() => document.getElementById('portal').scrollTo(0, 0)); await p.waitForTimeout(200);
  await p.screenshot({ path:'portal-facts.png' });
  // reload: portal again; entering offers the saved scan
  await p.reload(); await p.waitForTimeout(2500);
  console.log('reload: portal', await vis('#portal'));
  await p.click('[data-ministry="attack"]'); await p.fill('#gatePw', process.env.BH_GATE_PASSWORD); await p.press('#gatePw', 'Enter'); await p.waitForTimeout(600);
  console.log('resume offer:', await vis('#landResume'), (await p.textContent('#landResume')).trim());
  await p.click('#landResume'); await p.waitForTimeout(800);
  console.log('resumed into app:', !(await p.evaluate(() => document.body.classList.contains('landing'))), '| towns', await p.evaluate(() => towns.length));
  // five wrong attempts: a pause
  await p.click('#lockBtn'); await p.waitForTimeout(300); await p.click('[data-ministry="intel"]');
  for (let i = 0; i < 5; i++) { await p.fill('#gatePw', 'nope' + i); await p.press('#gatePw', 'Enter'); await p.waitForTimeout(80); }
  console.log('lockout:', await p.textContent('#gateErr'), '| button disabled', await p.isDisabled('.g-go'));
  // phone width
  await p.click('#gateCancel'); await p.setViewportSize({ width:390, height:844 }); await p.evaluate(() => document.getElementById('portal').scrollTo(0, 0)); await p.waitForTimeout(300);
  await p.screenshot({ path:'portal-mobile.png' });
  console.log('mobile overflow:', await p.evaluate(() => { const el = document.getElementById('portal'); return el.scrollWidth > el.clientWidth; }));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
