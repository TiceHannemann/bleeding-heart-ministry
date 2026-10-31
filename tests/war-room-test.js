const { chromium } = require('playwright');
const fs = require('fs');
const page = fs.readFileSync(require('path').resolve(__dirname, '../app/war-room.html'), 'utf8');
const html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${page}</body></html>`;
fs.writeFileSync(__dirname + '/wr-test.html', html);
const fake = `
(() => {
  const store = {}; const subs = [];
  const now = Date.now(), D = 864e5;
  const coll = p => Object.entries(store).filter(([k]) => k.startsWith(p + '/') && k.split('/').length === p.split('/').length + 1);
  const notify = () => subs.forEach(s => s());
  const mk = (path, data) => ({ id:path.split('/').pop(), exists:!!data, data:() => data, metadata:{ fromCache:false, hasPendingWrites:false } });
  let n = 0;
  function query(p, ord, lim) {
    const run = () => { let r = coll(p).map(([k, v]) => mk(k, v)); if (ord) r.sort((a, b) => ((a.data()[ord[0]] ?? 0) - (b.data()[ord[0]] ?? 0)) * (ord[1] === 'desc' ? -1 : 1)); if (lim) r = r.slice(0, lim); return { docs:r, size:r.length, empty:!r.length, metadata:{ fromCache:false } }; };
    return { orderBy:(f, d) => query(p, [f, d], lim), limit:l => query(p, ord, l), get:async () => run(), onSnapshot:(next) => { const s = () => next(run()); subs.push(s); setTimeout(s, 50); return () => {}; },
      doc:id => doc(p + '/' + (id || 'd' + (++n))), add:async data => { const r = doc(p + '/d' + (++n)); await r.set(data); return r; } };
  }
  function doc(path) { return { id:path.split('/').pop(), path, get:async () => mk(path, store[path]), set:async d => { store[path] = JSON.parse(JSON.stringify(d)); notify(); },
    update:async d => { if (!store[path]) throw { code:'invalid_argument' }; Object.assign(store[path], JSON.parse(JSON.stringify(d))); notify(); }, delete:async () => { delete store[path]; notify(); },
    acquire:async () => ({ acquired:true }) }; }
  const db = { collection:query, doc }; window.__bump = () => { const k = Object.keys(store).find(k => k.startsWith('notes/')); if (k) { store[k].pinned = !store[k].pinned; store[k].updatedAt = Date.now(); store[k].updatedBy = 'u_ana'; notify(); } };
  // seed: a few targets and two intel snapshots
  const nat = (a, c) => ['Bleeding_Heart','Rome','Carthage','Gaul','Persia'].map((n, i) => ({ n, a:a + i * 7, r:200 + i * 5, t:50 + i, c:c + i * 90, g:20000 + i * 3000 + a * 10, al:2, en:2 }));
  for (let i = 0; i < 6; i++) store['intel/s' + i] = { at:now - (5 - i) * 2 * D, by:'u_me', towns:2400, ruined:30, purgeMin:600, hq:'Bleeding_Heart', nations:nat(60 + i * (i % 2 ? 3 : -2), 1500 + i * 40).map((x, j) => j === 2 ? { ...x, a:x.a - i * 6, c:x.c - i * 50 } : x),
    candidates:i === 5 ? [{ town:'Town88', kind:'ruin', nation:'Gaul', x:120, z:-400, eta:now + 5 * 36e5, gold:412, warp:'Town86' }, { town:'Town147', kind:'overclaim', nation:'Carthage', x:2000, z:300, chunks:12 }, { town:'Town22', kind:'ruin', nation:'Carthage', x:-200, z:90, eta:now + 30 * 36e5, gold:66 }] : [] };
  store['targets/t1'] = { town:'Town22', kind:'ruin', nation:'Carthage', x:-200, z:90, eta:now + 30 * 36e5, gold:66, warp:'Town21', note:'Big storage room under the church', status:'open', claimedBy:null, createdBy:'u_ana', createdAt:now - 36e5, updatedAt:now - 36e5 };
  store['targets/t2'] = { town:'Town9', kind:'overclaim', nation:'Persia', x:900, z:120, chunks:9, status:'claimed', claimedBy:'u_ana', createdBy:'u_me', createdAt:now - 2 * 36e5, updatedAt:now - 30 * 6e4 };
  store['targets/t3'] = { town:'Town3', kind:'ruin', nation:'Rome', x:40, z:40, status:'done', claimedBy:'u_bo', loot:'2 shulkers of iron', doneAt:now - 3 * 36e5, createdBy:'u_bo', createdAt:now - D, updatedAt:now - 3 * 36e5 };
  const people = { u_me:'You', u_ana:'Ana', u_bo:'Bo' };
  const user = { me:async () => ({ id:'u_me', name:'Tice', avatarUrl:'', color:'#fff', email:null, isOwner:true, canEdit:true }), can:async () => true, isOwner:async () => true, canEdit:async () => true, id:async () => 'u_me',
    profiles:async ids => Object.fromEntries([].concat(ids).map(id => [id, { id, name:people[id] || '', avatarUrl:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="#666"/></svg>'), color:'#999', email:null, isMe:id === 'u_me', guest:false }])) };
  const room = { presence:async () => {}, onPeers:fn => { setTimeout(() => fn({ peers:[{ by:'u_me', kind:'viewer', isMe:true }, { by:'u_ana', kind:'viewer' }], joined:[], left:[], updated:[] }), 80); return () => {}; } };
  window.claude = { use:async name => ({ db, user, room })[name] || null };
})();`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport:{ width:1400, height:1300 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://fonts.**', r => r.abort());
  await p.addInitScript(fake);
  await p.goto('file://' + __dirname + '/wr-test.html');
  await p.waitForTimeout(600);
  console.log('stats', await p.textContent('#sOpen'), await p.textContent('#sClaimed'), await p.textContent('#sDone'), '| here:', await p.textContent('#here'));
  await p.click('[data-act="addsug"]'); await p.waitForTimeout(200);
  await p.locator('.card', { hasText:'Town88' }).locator('[data-act="claim"]').click(); await p.waitForTimeout(200);
  await p.locator('.card', { hasText:'Town88' }).locator('[data-act="donefor"]').click(); await p.waitForTimeout(100);
  await p.fill('[id^="loot-"]', 'diamonds + beacon'); await p.click('form[data-form="done"] button[type=submit]'); await p.waitForTimeout(200);
  console.log('after raid: open/claimed/done', await p.textContent('#sOpen'), await p.textContent('#sClaimed'), await p.textContent('#sDone'));
  console.log('leaderboard:', (await p.locator('.lower table').innerText()).replace(/\n/g, ' | '));
  await p.screenshot({ path:'wr-board.png' });
  await p.goto('file://' + __dirname + '/wr-test.html#intel'); await p.waitForTimeout(600);
  await p.selectOption('#nationPick', 'Carthage'); await p.waitForTimeout(200);
  await p.screenshot({ path:'wr-intel.png' });
  // import
  await p.goto('file://' + __dirname + '/wr-test.html#import'); await p.waitForTimeout(500);
  const pkg = JSON.stringify({ kind:'bleeding-heart-intel', v:1, at:Date.now(), towns:2500, ruined:31, purgeMin:600, nations:[{ n:'Rome', a:90, r:220, t:52, c:1700, g:30000, al:2, en:2, rk:19, st:'ally', hs:0, fr:68, sg:72, fl:[], sm:'Rome is a major power, growing. Stance toward Bleeding Heart: ally.' }, { n:'Carthage', a:55, r:200, t:40, c:1088, g:18000, al:2, en:2, rk:52, st:'hostile', hs:87, fr:0, sg:66, fl:['Vulnerable rival','<b>x</b>'], sm:'Carthage is hostile <script>alert(1)</script>.' }], candidates:[{ town:'<img src=x onerror=alert(1)>', kind:'ruin', eta:Date.now() + 36e5 }] });
  await p.fill('#paste', pkg); await p.waitForTimeout(200);
  console.log('preview:', await p.locator('.preview').innerText());
  await p.click('[data-act="save"]'); await p.waitForTimeout(400);
  console.log('after save view:', await p.evaluate(() => location.hash), '| suggestion shows escaped:', await p.locator('.sugg').innerText().catch(() => 'none'));
  
  await p.goto('file://' + __dirname + '/wr-test.html#notes'); await p.waitForTimeout(500);
  await p.click('[data-act="newnote"][data-kind="alliance"]'); await p.waitForTimeout(300);
  await p.fill('#noteTitle', 'Western Pact'); await p.fill('#noteNations', 'Rome, Gaul, Atlantis');
  await p.fill('#noteBody', 'Rome brings warps.\nGaul brings gold.'); await p.waitForTimeout(1200);
  console.log('alliance totals:', (await p.locator('#allyTot').innerText()).replace(/\n/g,' | '));
  console.log('save state:', await p.textContent('#saveState'));
  await p.click('[data-act="newnote"][data-kind="plan"]'); await p.waitForTimeout(300);
  await p.fill('#noteTitle', 'Take Carthage border'); await p.selectOption('#noteStatus','active'); await p.fill('#noteBody', 'Step 1: claim 3 adjacent.'); await p.waitForTimeout(1200);
  console.log('list:', (await p.locator('#noteList').innerText()).replace(/\n/g,' | '));
  await p.locator('.n-item', { hasText:'Western Pact' }).click(); await p.waitForTimeout(300);
  console.log('reopened body keeps newlines:', JSON.stringify(await p.inputValue('#noteBody')));
  // typing is not clobbered by a live update from someone else
  await p.focus('#noteBody'); await p.keyboard.type(' More');
  await p.evaluate(() => window.__bump && window.__bump());
  await p.waitForTimeout(200);
  console.log('while typing, body =', JSON.stringify(await p.inputValue('#noteBody')));
  await p.waitForTimeout(1200);
  await p.click('a[href="#intel"]'); await p.waitForTimeout(400);
  await p.selectOption('#nationPick', 'Carthage'); await p.waitForTimeout(300); console.log('brief panel:', (await p.locator('.brief-panel').innerText()).replace(/\n/g, ' | ')); console.log('assess table first row:', (await p.locator('section.panel', { hasText:'stance and risk' }).locator('tr').nth(1).innerText()).replace(/\s+/g, ' ')); await p.screenshot({ path:'wr-brief.png' }); console.log('intel named alliances:', (await p.locator('section.panel', { hasText:'Named alliances' }).innerText()).replace(/\n/g,' | '));
  await p.goto('file://' + __dirname + '/wr-test.html#notes'); await p.waitForTimeout(500);
  await p.screenshot({ path:'wr-notes.png' });
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
