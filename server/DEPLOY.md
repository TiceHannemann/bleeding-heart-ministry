# Putting the Ministry online (hourly scans)

The server in this folder hosts both websites and scans EarthMC every hour on its own, with no browser left open.

## What it does

| Address | What's there |
|---|---|
| `/` | The public website. Its "Government staff" links go to `/gov`. |
| `/login` | Sign-in. The password is checked **on the server**; the ministries' page is never sent to anyone who isn't signed in. |
| `/gov` | The ministries (the same `app/earthmc-ruin-scanner.html`). On opening, it loads the server's latest hourly scan and full archive, so every page, dossier, forecast and briefing runs on the server's data. |
| `/gov/reports` | The hourly reports: the Daily Intelligence Summary (eyes-only and releasable), Intelligence Assessments of the five leading threats, and Support Assessments for allies, as PDFs and text. Also "Scan now" and "Send an archive to the server". |
| `/healthz` | Health check and collector status. |

**How the hourly scan works.** Every hour (three minutes past), the collector opens the ministries' page in headless Chromium and presses Scan. The page does everything it already did: archives the scan, logs events, runs and grades the Forecast Lab, and writes the briefings. The browser profile is stored on the data volume, so the archive keeps growing between hours and across restarts. The collector then saves the reports and exports the archive for visitors. Nothing in the intelligence system was rewritten, so changes made to the HTML automatically apply to the hourly reports.

**Data kept** (in `DATA_DIR`): `profile/` (the archive itself), `archive.json.gz` (what visitors download), `runs/<time>/` (reports; every run for seven days, then one a day), `imports/` (uploaded browser archives, merged at the next scan), `status.json`.

## Deploy on Railway (recommended)

1. Put this whole `bleeding-heart-ministry` folder in a **private** GitHub repository. The `Dockerfile` and `railway.json` are at its top level.
2. On railway.com: **New Project → Deploy from GitHub repo**, and choose the repository. It builds from the Dockerfile.
3. In the service: **Settings → Volumes → Add volume**, mount path `/data`. Without this, the archive is wiped on every deploy.
4. **Variables:**
   - `MINISTRY_PASSWORD`: optional ministry password. Without it the whole site is open to everyone with no sign-in, and archive uploads are turned off.
   - `SESSION_SECRET`: optional; a long random string. If unset, one is generated and kept on the volume.
   - `HOME_NATION`: optional; defaults to the site's own setting (`Bleeding_Heart`).
   - `SCAN_EVERY_MINUTES`: optional; default `60`, minimum `15`.
5. **Settings → Networking → Generate domain** (or add your own domain).
6. Open `https://<your-domain>/healthz`. The first scan starts within a minute of boot and takes a few minutes; `lastOk` appears when it is done, and `/gov/reports` fills in.

Plan on about 1 GB of memory (Chromium runs for a few minutes each hour) and a 1 GB volume to start. Keep **one replica**: two would scan twice.

## Run it on your own computer

```bash
cd server
npm install
npx playwright install chromium
INSECURE_COOKIE=1 MINISTRY_PASSWORD=choose-one node server.js
```

Then open http://localhost:8080. (`INSECURE_COOKIE=1` is only for plain-http local use. On Windows PowerShell set the variables with `$env:INSECURE_COOKIE=1; $env:MINISTRY_PASSWORD="choose-one"; node server.js`.)

The end-to-end test, with a fake EarthMC API and no network: `node tests/server-test.js` from the project folder after `npm install` in `server/`.

## Ministry of Finance

EarthMC keeps shop item prices private to each shop's owner, so the Finance ministry reads the public economy instead:

- **Every hour:** every town and nation bank, taken from the hourly scan with no extra requests.
- **Every three hours**, between hourly scans (20–50 minutes past the hour): every player's balance (about 45,000 players, roughly 450 requests) and every quarter with its sale price (about 24,000 quarters, roughly 240 requests). That takes a few minutes and stays under the rate limit.

It has three pages:

- **Market Board:** a scrolling ticker; the wealth of every nation (bank, town banks and members' gold) with 24-hour and 7-day changes and 30-day sparklines; the richest players; the biggest movers; and the treasury watch, towns spending their bank fast enough to run dry within a week.
- **Property Market:** every quarter for sale. **Steals** are priced at half the local rate per block or less. Also price cuts, new listings, and towns for sale, flagged when the town's own bank already covers the price.
- **Money Flows:** payments found by matching one balance falling and another rising by the same amount between two player scans, drawn on the map as arcs from payer to receiver, plus gold moving between nations over the week.

The Daily Summary gets an "Economic Developments" section, and each Intelligence Assessment's Economy section gets the nation's full wealth, its gold flows, towns running dry and its property listings.

Settings: `FINANCE_EVERY_HOURS` (default `3`). Data is kept in `/data/finance`.

## EarthMC API key

Make a key in game with `/api key create`. It belongs to your account, so keep it out of this repository (it is public) and out of `docker-compose.yml`. On the server, put it in a file the rebuild doesn't delete:

```bash
printf 'EMC_KEY=your-key\nEMC_PLAYER=YourMinecraftName\n' > /root/bh.env && chmod 600 /root/bh.env
```

Then rebuild with `--env-file /root/bh.env` added to `docker compose`. The key stays in the server process. It never reaches a browser, the archive, the reports or `/api/status`.

What it adds:

- **Rankings (Intelligence):** the mcMMO leaderboards, the top 25 in every combat and gathering skill and in overall power, read one board every two minutes (EarthMC's limit), so all twenty refresh about every 45 minutes. Each ranked player is placed in their town and nation. Nations are scored by their fighters' places. Also the server's running pursuits, for players, towns and nations.
- **In the reports:** each Intelligence Assessment's Military Potential section names the nation's ranked fighters, and the Daily Summary gets a "Fighting Strength and Pursuits" section. Nation dossiers get a Fighters tile.
- **The new day:** the event stream reports the new day. A scan follows three minutes later, so towns that fell show in the Ruin Hunter within minutes rather than up to an hour, and the purge countdown uses the exact time.
- **Ledger (Finance), with `EMC_PLAYER`:** your shops with stock (and on the map), your trades as they happen (sales, purchases, out of stock, full, out of gold), the bank history of a town or nation you lead or keep the books of, and notices for your town and nation. The site is open, so anyone who has its address can see this page.

EarthMC sends shop, town and nation events only to the shop owner, mayor or leader concerned. Other players' mcMMO profiles are refused, so per-player skills come only from the leaderboards. Settings: `EMC_KEY`, `EMC_PLAYER`. Data is kept in `/data/keyed`. Status: the `keyed` part of `/api/status`.

## Open-channel signals (Discord chat)

The server reads Discord chat exports (DiscordChatExporter JSON) each hour and writes what matters into the briefings, as a "Signals from Open Channels" section in each Intelligence Assessment and in the Daily Summary.

1. **Cleanup in code, free:** empty, very short and deleted messages are dropped, and news reposted in several servers is read once and counted as carried by each.
2. **Claude** (`claude-opus-5-5`) reads the rest in batches. It keeps only in-game diplomacy and intelligence: treaties, NAPs, wars, raids, mergers, recruitment, leadership changes. It drops memes, small talk and real-world politics. Each event cites its source messages and gets a confidence rating from who said it.
3. **Merging:** the same event reported again later or elsewhere joins the existing one. Reported alliances are checked against the server's own alliance lists.
4. **Retention:** raw messages are kept for 30 days and events for 90.

Settings: `ANTHROPIC_API_KEY` (without it, chat is collected but not analysed) and `CHAT_UPLOAD_TOKEN` (any long random string; the upload script sends it). Upload from your PC with `tools/send-chat.ps1`. Status: `/api/signals`.

## History of Terra Nostra

The Briefing Room has a **History** document. It is a narrative of the server written from full Discord archives. It covers chapters by period, how wars are actually fought, the powers today, a dated timeline, a register of sources, and an assessment of their biases. Parts of it are computed live from the latest scan: which of the leading nations the Ministry reads directly, which it sees only second-hand, and what has happened since the archive ended. Intelligence Assessments also note whether the Ministry reads the nation's own server. Chat signals say when a report comes only from one side's server.

1. Distil the exports, of any size: `node tools/discord-digest.js <exports folder> <out folder>`. It writes `sources.json` (coverage per channel), `kept.jsonl` and monthly `digest/*.txt`.
2. Write the history JSON from the digest (`kind: "terra-nostra-history"`). The format is the one `server/history.js` checks: `asOf`, `title`, `basis`, `summary`, `chapters`, `themes`, `sources`, `bias`, `gaps`, `timeline`.
3. Send it with `tools/send-history.ps1 -File <json> -Server <site address> -Token <CHAT_UPLOAD_TOKEN>`. It reaches the page within minutes, with no scan needed.

The history is kept on the data volume (`/data/history`), not in this repository, because it names the servers the Ministry reads. The releasable version leaves out the source register and the collection plan.

## Bringing over earlier collection

In a browser that ran Watch mode, open the Briefing Room and export the archive, then on `/gov/reports` press **Send an archive to the server**. It is merged at the next hourly scan.

## Things to know

- **Your browser follows the server.** When a new hourly scan is loaded, the browser's own scans, series and forecasts are replaced by the server's. Movement Watch visits recorded in your browser are kept.
- **Movement Watch records around the clock.** The collector's browser stays open between scans and reads the live map every 15 seconds through the server's `/api/players` relay. Recorded visits reach visitors with each hourly archive; visitors' pages show who is on the map right now but don't record. The browser restarts once a day and reopens itself after a crash.
- **There are no Watch mode or Track positions switches.** Scanning and tracking always run.
- **Rate limit.** A scan uses about the same number of requests as a manual one (paced at 150 a minute), once an hour.
