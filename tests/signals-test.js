// Open-channel signals, without the network: real DiscordChatExporter files go through intake, cleanup and
// de-duplication; a stand-in for Claude answers like the real model would; the briefings show the result.
// Usage: node tests/signals-test.js <folder of exports> <archive.json.gz from a server scan>
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib');
const [dir, archive] = process.argv.slice(2);
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-sig-'));
const { chromium } = require(path.join(__dirname, '../server/node_modules/playwright'));
const signals = require('../server/signals.js');

let request = null;
global.__signalsClient = { beta:{ messages:{ create:async body => {
  request = body;
  // answer as the model should: the NAP reports are events, everything else is chatter
  const lines = body.messages[0].content.split('\n').filter(l => /\bNAP\b/i.test(l));
  const id = l => l.match(/^\[(\d+)\]/)[1];
  const dk = lines.filter(l => /Denmark/.test(l)), sf = lines.filter(l => /Svalbard/.test(l));
  const events = [
    dk.length && { type:'non_aggression_pact', nations:['Denmark', 'Rhodesia'], summary:'Denmark and Rhodesia signed a non-aggression pact', confidence:'high', status:'reported', importance:3, source_ids:dk.map(id) },
    sf.length && { type:'non_aggression_pact', nations:['Svalbard', 'Finland'], summary:'Svalbard and Finland signed a non-aggression pact', confidence:'high', status:'reported', importance:2, source_ids:sf.map(id) },
  ].filter(Boolean);
  return { stop_reason:'end_turn', content:[{ type:'text', text:JSON.stringify({ events }) }], usage:{ input_tokens:Math.round(body.messages[0].content.length / 4), output_tokens:200 } };
} } } };

(async () => {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) fs.copyFileSync(path.join(dir, f), path.join(signals.INBOX, f.replace(/[^\w.-]+/g, '_')));
  const A = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)));
  const names = [...new Set(A.lastScan.details.map(t => t.nation?.name).filter(Boolean))];
  const ev = await signals.run(names);
  const st = signals.status();
  console.log(`intake: ${st.files} files · ${st.newMessages} messages kept after cleanup · ${st.read} sent to the model (after removing reposts)`);
  console.log(`request: ${request.model} · ${Math.round(request.messages[0].content.length / 4).toLocaleString()} tokens of chat · fallbacks ${request.fallbacks} · schema ${request.output_config.format.type}`);
  console.log('events:', ev.map(e => `${e.summary} [${e.servers} servers, ${e.sources.length} sources]`).join(' | '));
  // a second run with nothing new makes no request
  request = null; await signals.run(names); console.log('second run, nothing new → request made:', !!request);

  const b = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {});
  const p = await b.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('https://**', r => r.abort());
  await p.addInitScript(() => { try { sessionStorage.setItem('bh_unlocked', '["attack","intel"]'); sessionStorage.setItem('rh_booted', '1'); } catch {} });
  await p.goto('file://' + path.resolve(__dirname, '../app/earthmc-ruin-scanner.html'));
  await p.waitForFunction(() => typeof appReady !== 'undefined'); await p.evaluate(() => appReady);
  const out = await p.evaluate(([scan, ev]) => {
    hydrate(scan); SIGNALS = ev;
    const pick = s => s.sections.filter((x, i, a) => { const h = a.slice(0, i + 1).reverse().find(y => y.type === 'h'); return h && /Open Channels/.test(h.text) && x.type === 'p'; }).map(x => x.text);
    const dk = findNation('Denmark');
    return { nation:dk ? pick(nationAssessment(dk, findNation('Bleeding_Heart'), false)) : ['Denmark not in this scan'], intsum:pick(intsum(false)) };
  }, [A.lastScan, ev]);
  console.log('\nDenmark assessment, Signals from Open Channels:\n  ' + out.nation.join('\n  '));
  console.log('\nDaily summary, Signals from Open Channels:\n  ' + out.intsum.join('\n  '));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
