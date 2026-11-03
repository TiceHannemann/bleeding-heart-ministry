# Working in this repository

Intelligence and attack site for the nation **Bleeding_Heart** on **EarthMC, Terra Nostra world**
(never Aurora). Read `AGENT-HANDOFF.md` first — it is the current handoff. `README-HANDOFF.md` is
older; its owner preferences (section 2), data rules (section 5) and Forecast Lab notes (section 6)
still hold, but its parts on the password gate, the claude.ai War Room artifact and "next steps" are
out of date.

## The one thing to do at the start of every session

```bash
node tools/agent-heart-relay.mjs          # pull new Discord intel (needs DISCORD_BOT_TOKEN)
```

Then read **`intel/RELAY-CONTRACT.md`** and process anything new in `intel/inbox/`.

## What `intel/` is

Agent Heart — the Hermes Discord bot — reads the `Bleeding_heart` collection server, where the owner
has **followed** announcement channels from EarthMC nation servers. Treaties and government
announcements on EarthMC are frequently posted as **images**, not text, so the raw message text alone
is not enough.

The relay runs in two halves:

1. **Collection** (deterministic, no model) — `tools/agent-heart-relay.mjs` fetches new messages,
   downloads image attachments into `intel/attachments/`, and writes one raw record per message into
   `intel/inbox/raw/`. A cursor in `intel/state.json` stops it re-reading the same message.
2. **Analysis** (model) — a Hermes cron job reads each new raw record, **OCRs every attached image**,
   decides what is worth keeping, and writes normalised records into `intel/inbox/items/`.

Your job as the implementing agent is the third step: read `intel/inbox/items/`, fold what matters
into the site's briefings, then move processed items to `intel/inbox/processed/`.

Full specification: **`intel/RELAY-CONTRACT.md`**. Read it before touching anything in `intel/`.

## Rules that are not negotiable

- **Never commit a token or key.** Not in `intel/`, not in the HTML, not in the archive, not in
  `/api/status`. Secrets live only in `/root/bh.env` on the VPS and in the local `.env`.
- **This repository is public.** `intel/` contains raw Discord material — named players, quoted
  accusations, screenshots. None of it may appear in a **releasable** report. Releasable reports
  omit, per `AGENT-HANDOFF.md`: sources and methods (which servers were read, named players'
  movements, collection hours, the Forecast Lab record); the Kingdom's own weak points and plans;
  and stance and hostility ratings except declared enmity.
- **Do not recommend Discord self-bots.** Automating a user account breaks Discord's terms. Agent
  Heart is a real bot with Message Content intent, which is the sanctioned route.
- **Do not edit `app/earthmc-ruin-scanner.html` casually.** It is one ~620 KB file with top-level
  `const` declarations; code that runs at load time must come after the declarations it uses or the
  page dies with a temporal dead zone error. Run `tests/err.js` after any edit.

## House style for anything written

Reports read as real government prose: long paragraphs, numbered sections (1.1, 1.2), no bullet
lists, no tinted "key judgment" boxes, no uppercase micro-labels. Tables and charts belong in
annexes after the signature. Small numbers as words, changes in words ("fallen by 27", not "-27"),
standard estimative language. The UI is minimal, monochrome dark and Swiss; detail hides behind
hover, never crowds the screen.

## Running and testing

```powershell
cd server; npm install
$env:NODE_PATH="server\node_modules"; $env:BROWSER_CHANNEL="msedge"; node -r .\dev\use-edge.js tests\server-test.js
```

It prints "no errors" on success. `deep-test` and `moves-test` print a harmless `TargetClosedError`
at exit. `portal-test` needs `BH_GATE_PASSWORD`. `node dev/run-local.js` serves a local preview on
http://localhost:8790/gov.
