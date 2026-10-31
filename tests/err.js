const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message, (e.stack||'').split('\n')[1]));
  p.on('console', m => m.type()==='error' && console.log('CONSOLE', m.text()));
  await p.goto('file://' + require('path').resolve(__dirname, '../app/earthmc-ruin-scanner.html') + ''); await p.waitForTimeout(1500); await b.close(); })();
