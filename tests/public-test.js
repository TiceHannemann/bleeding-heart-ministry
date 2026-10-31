const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport:{ width:1440, height:900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let posts = 0;
  await p.route('https://api.earthmc.net/**', async r => {
    const req = r.request(), u = req.url(); posts++;
    const q = JSON.parse(req.postData() || '{}').query || [];
    if (u.endsWith('/nations')) return r.fulfill({ json:[{ name:'Bleeding_Heart', king:{ name:'KingAlfred' }, capital:{ name:'Heartford' }, towns:['Heartford', 'Rosewater', 'Thornfield', 'Old Ruin'].map(name => ({ name })),
      stats:{ numResidents:128, numTownBlocks:1082 }, timestamps:{ registered:Date.parse('2024-03-12') } }] });
    if (u.endsWith('/towns')) return r.fulfill({ json:q.map((name, i) => ({ name, mayor:{ name:'Mayor' + i }, stats:{ numResidents:[40, 12, 7, 2][i] }, status:{ isPublic:i !== 2, isRuined:name === 'Old Ruin' }, timestamps:{ registered:Date.parse('2024-05-0' + (i + 1)) } })) });
    return r.abort();
  });
  await p.goto('file://' + require('path').resolve(require('path').resolve(__dirname, '../app/kingdom-of-the-bleeding-heart.html'))); await p.waitForTimeout(1200);
  console.log('requests:', posts, '| facts:', (await p.locator('#facts').innerText()).replace(/\n/g, ' '));
  console.log('crown:', await p.textContent('#crownLine'));
  console.log('directory:', (await p.locator('#townList tr').allInnerTexts()).map(x => x.replace(/\t/g, ' | ')).join(' // '));
  await p.fill('#townSearch', 'rose'); console.log('search rose:', await p.locator('#townList tr').count() - 1, 'row');
  await p.fill('#townSearch', '');
  console.log('staff link:', await p.getAttribute('.p-staff', 'href'), '| mentions intel code:', await p.evaluate(() => /putangina|GATE_HASH|assessAll|Movement Watch/.test(document.documentElement.outerHTML)));
  await p.screenshot({ path:'public-top.png' });
  await p.evaluate(() => document.getElementById('towns').scrollIntoView()); await p.waitForTimeout(600); await p.screenshot({ path:'public-towns.png' });
  await p.setViewportSize({ width:390, height:844 }); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400); await p.screenshot({ path:'public-mobile.png' });
  console.log('mobile overflow:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  // API down: the page still works
  const p2 = await b.newPage(); p2.on('pageerror', e => errs.push(e.message)); await p2.route('https://api.earthmc.net/**', r => r.abort());
  await p2.goto('file://' + require('path').resolve(require('path').resolve(__dirname, '../app/kingdom-of-the-bleeding-heart.html'))); await p2.waitForTimeout(800);
  console.log('offline:', (await p2.textContent('#townList')).trim(), '| facts hidden', await p2.isHidden('#facts'));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
