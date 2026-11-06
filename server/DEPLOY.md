# Putting the Ministry online (hourly scans)

The server in this folder hosts both websites and scans EarthMC every hour on its own, with no browser left open.

## What it does

| Address | What's there |
|---|---|
| `/` | The public website. Its "Government staff" links go to `/gov`. |
| `/login` | Sign-in. The password is checked **on the server**; the ministries' page is never sent to anyone who isn't signed in. |
| `/gov` | The ministries (the same `app/earthmc-ruin-scanner.html`). On opening, it loads the server's latest hourly scan and full archive, so every page, dossier, forecast and briefing runs on the server's data. |
| `/healthz` | Health check and collector status. |

**How the hourly scan works.** Every hour (three minutes past), the collector opens the ministries' page in headless Chromium and presses Scan. The page does everything it already did: archives the scan, logs events, runs and grades the Forecast Lab, and writes the briefings. The browser profile is stored on the data volume, so the archive keeps growing between hours and across restarts. The collector then saves the reports and exports the archive for visitors. Nothing in the intelligence system was rewritten, so changes made to the HTML automatically apply to the hourly reports.

**The Briefing Room** (Intelligence) is where every report lives, on one page:

- **Today's briefing:** the Daily Intelligence Summary, an Intelligence Assessment of each of the five leading threats (nations showing hostility to the Kingdom, the number beside each is that hostility), and a Support Assessment for the allies most at risk of collapse (the number is their collapse risk). The server writes this same set as PDFs after every scan.
- **Any nation:** an Assessment or a Support Assessment of any nation, and for an assessment, which nation it is seen from.
- **Earlier editions:** the PDFs the server saved, one edition a day for two weeks.
- Either classification, Kingdom eyes only or Releasable to allies, as a PDF or copied as text. With a password set, an archive from another browser can be sent to the server from here too.

`/gov/reports`, the old reports page, now opens the Briefing Room.

**Two scores, two directions.** *Collapse risk* is how likely a nation is to lose towns or land itself: towns about to ruin, land that can be overclaimed, inactive members, an absent leader, decline and a thin bank. *Hostility to us* is how set against the Kingdom it is: enmity with us, alliances with our enemies, hostility to our allies, towns near ours. A rival with high collapse risk is an opportunity; one with high hostility is a threat.

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

With Docker Compose the site may use at most 1,500 MB. The Briefing Room, under Earlier editions, says how much the server is using, the most the last scan needed, and whether it has run out of memory; when it has, the error under "Last scan failed" says so too. To allow more, add `BH_MEMORY=2500m` to `/root/bh.env` and rebuild, leaving enough for anything else on the VPS. A failed scan is tried again after ten minutes, then twenty, then forty, then hourly, never back to back.

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

- **Leaderboards (on the Combat page, Intelligence):** the mcMMO leaderboards, the top 25 in every combat and gathering skill and in overall power, read one board every two minutes (EarthMC's limit), so all twenty refresh about every 45 minutes. Each ranked player is placed in their town and nation. Nations are scored by their fighters' places. Also the server's running pursuits, for players, towns and nations.
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

## Ministry of Population

Built from the Finance player scan (every player's full record, every few hours), so it costs no extra requests.

- **Recruits:** players active this week who are in no town (most recently online first), new accounts from the last two weeks (the townless first), which nations are recruiting fastest, and ranked fighters or killers with no town. On the map: townless players visible right now.
- **Migration:** each scan is compared with the last, so a player whose nation changed is a move. It shows gains and losses by nation over the week, every move, and the busiest corridors, drawn on the map as arcs. Moves show from the second player scan after this update.

The Daily Summary gets a "Population and Migration" section. Each Intelligence Assessment says who joined the nation and who it gained or lost. Data is kept in `/data/population`.

## Combat: who kills whom

EarthMC's in-game chat bridge posts every player kill to Discord ("☠ Victim was killed by Killer"). Kills reach the server two ways:

1. **Any size of export, from your PC:** `node tools/discord-kills.js <export file or folder> --send http://YOUR-SITE:8080 --token <CHAT_UPLOAD_TOKEN>`. It reads the exports line by line (1.2 GB takes about half a minute), writes `kills.json` and sends it.
2. **Chat uploads:** any export sent with `tools/send-chat.ps1` is searched for kills too.

From the kills, the Combat page (Intelligence) shows each pair of nations that fought and what kind of fighting it was:

- **War:** both sides killing, three or more fighters each, over several days.
- **Raid:** one-sided, several killers, many kills on one day.
- **Hunting:** one-sided, one or two killers.
- **Skirmish:** anything smaller.

It also lists the killers (a **hunter** has many victims across many nations; **same opponent** is the same victim over and over) with the hours they fight, kills and deaths by nation, and the leaderboards. **On the move** lists ranked fighters and leading killers seen on the live map in the last day, with where they are, which way they are heading and which nations they have been in.

Fighters are followed by the server's browser: every sighting of a ranked fighter or leading killer is kept for a week, and rival players meeting within 8 blocks are noted as clashes. Both reach visitors with the hourly archive. Nations are each player's nation at the latest player scan, so old kills may be credited to a nation the player has since left. Data is kept in `/data/combat`.

## Movement history

The server keeps where every player on the live map has been, for a year: a position when they have moved 64 blocks (at most every 30 seconds), where they were just before and just after a teleport, where they were last seen before leaving the map, and one every ten minutes while they stand still. It records from the same live-map feed Movement Watch reads, and reads the feed itself whenever no page asks for it, so recording carries on while the browser restarts.

Click any player to open their card: **Movement** draws their path over the last day, week, month or year among the towns around it, with the nations where they spent the most time and where they were last seen. **Show the path on the map** draws it in white on the Movement Watch map. Players can hide from the live map, so a gap is not proof of absence. A player's movements are the Kingdom's own; they are never part of a releasable report.

Positions are kept on disk in `/data/trails`, one file per player per month, and read only when a card asks for them, so they cost almost no memory. Expect a few megabytes a day while the month is open, and about a third of that once a month ends and is compressed; a year comes to roughly half a gigabyte. To keep less, add `TRAILS_KEEP_DAYS=90` to `/root/bh.env`. `/api/status` reports how many players are on the map, how many positions were kept today and the space used.

## War Room

The War Room (Attack) is the Ministry's shared plan, on the site itself (it replaces the old War Room page on claude.ai):

- **The map** with drawing tools: waypoints, routes, targets, danger marks, rally points and notes. Routes show their length and travel time walking, sprinting, on a horse, by boat and by elytra; marks show their block coordinates and the town they fall in, and can be copied, edited, marked done or removed.
- **The raid board:** towns to hit, suggested from the latest scan (enemy and neutral towns falling at the next two purges, then the most land to overclaim) or added by hand. An officer claims a raid, and only one can hold it; when it's done they log what was taken. Open raids show on the map, and the board keeps a tally of the week's raids by officer.
- **Plans and alliances:** written plans (with a status, a date and the nations involved), named alliances (with their combined active members, towns, land and gold from the latest scan) and notes. They save a moment after typing stops; if two officers edit the same plan at once, the second save is refused and the newer version shown, so nobody's words are overwritten.
- **Sharing:** every open page picks up changes within a few seconds, and everything is kept in `/data/warroom`. Officers set their name once on the page; it is shown on their marks, claims and edits.

**Changing the plan needs a key.** Anyone who can open the ministries can see the plan. To change it, an officer needs one of these:

- the site password, when one is set;
- the war room key, which they enter once on the page.

The key is `WARROOM_KEY` if you set it, otherwise `CHAT_UPLOAD_TOKEN`. Give officers a separate key with:

```bash
echo 'WARROOM_KEY=choose-a-long-random-string' >> /root/bh.env
```

## What allies receive

Every report comes in two copies, Kingdom eyes only and Releasable to allies. The releasable copy keeps the picture of the server and the threats facing the alliance, and adds a section on the risks facing each ally. It leaves out:

- **How the Ministry collects:** the Discord servers it reads, the movements of named players, collection hours and the Forecast Lab's track record.
- **The Kingdom's own weak points and plans:** its towns at risk, opportunities, recommendations and recruitment targets.
- **How the Kingdom rates each nation:** stance labels and hostility scores, except where a nation has declared enmity.

## The map

The globe is the default view. It wraps the world border onto the sphere edge to edge: the border is x −64,512 to 64,511 and z −32,256 to 32,255, from the web map's "World Border" layer. So the Minecraft map covers the whole globe with no gaps at the poles or the date line, and every mark sits exactly on the map. The flat map stops at the border.

Scrolling zooms toward the cursor in both views. The old Earth coastline overlay is gone, since it never lined up with the Minecraft map.

## Bringing over earlier collection

In a browser that ran Watch mode, open the Briefing Room and export the archive, then on `/gov/reports` press **Send an archive to the server**. It is merged at the next hourly scan.

## Things to know

- **Your browser follows the server.** When a new hourly scan is loaded, the browser's own scans, series and forecasts are replaced by the server's. Movement Watch visits recorded in your browser are kept.
- **Movement Watch records around the clock.** The collector's browser stays open between scans and reads the live map every 15 seconds through the server's `/api/players` relay. Recorded visits reach visitors with each hourly archive; visitors' pages show who is on the map right now but don't record. The browser restarts once a day and reopens itself after a crash.
- **There are no Watch mode or Track positions switches.** Scanning and tracking always run.
- **Rate limit.** A scan uses about the same number of requests as a manual one (paced at 150 a minute), once an hour.
