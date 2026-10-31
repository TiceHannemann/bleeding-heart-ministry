# Kingdom of The Bleeding Heart — Ministry Intelligence Suite

Handoff package for continuing development. Everything needed to run, test and extend the project is in this folder.

The project is an intelligence and attack website for the nation **Bleeding_Heart** on **EarthMC, Terra Nostra world**. It uses the public API at `https://api.earthmc.net/v4` (the user explicitly does not want the Aurora world).

---

## 1. What's in the folder

| Path | What it is |
|---|---|
| `app/kingdom-of-the-bleeding-heart.html` | **The public website.** A standalone white government site (~80 KB): services, a live directory of Kingdom towns, government offices, notices. It contains no intelligence code or data and reads only public facts from the EarthMC API. |
| `app/earthmc-ruin-scanner.html` | **The government website** (the ministries). Single standalone file (~540 KB), the source of truth. It opens on a password-protected sign-in page. No server or build step. |
| `app/war-room.html` | Source of the hosted **War Room** page: a shared target board, intel trends, notes and alliance plans. It runs only inside the claude.ai artifact runtime (see §8). |
| `github-pages/index.html` | The public website prepared for GitHub Pages: the same page with the "Government staff" link removed. Upload it as `index.html` to a public repository and turn on Pages. |
| `app/relay.py` | Small Python 3 relay for Movement Watch. It is needed when the browser refuses to let the local file read the live map's player feed (CORS). It is also built into the app as a download button. |
| `assets/logo/` | National crest/logo: SVG, PDF, PNGs, and the JPEG used inside PDFs. These are already embedded as data URIs in the app. |
| `samples/briefings/` | Example PDF briefings, generated from test data. |
| `samples/screenshots/` | What each page looks like. |
| `tests/` | Playwright regression tests with a fake EarthMC API. Run them with `tests/run-all.sh`. |
| `dev-history/build/` | **Historical** module fragments and patch scripts used while building. They are **out of date**: later changes were made directly in the HTML. Use them only as reference; edit the HTML. |

---

## 2. Owner's preferences (important for tone and design)

- **Branding.** Use "Kingdom of The Bleeding Heart". The crest sits top-left, beside the name set in Helvetica. The style is governmental.
- **Ministries.**
  - The **Ministry of Attack** holds Ruin Hunter and Overclaim Finder.
  - The **Ministry of Intelligence** holds Nation Intelligence, Movement Watch, Briefing Room and Forecast Lab.
- **UI style.**
  - The look is minimal, monochrome dark and Swiss, with slick animation.
  - Detail should hide behind hover, not crowd the screen.
  - Fonts: Inter Tight, JetBrains Mono, and a Helvetica stack for the wordmark.
  - Accent colours: pink `#e8406f` for HQ, cyan `#7fe9ff` for Intelligence.
- **Reports and PDFs** must read like real government intelligence papers.
  - Write long, detailed **prose paragraphs**, numbered by section (1.1, 1.2 …).
  - Use **no** bullet lists, tinted "key judgment" boxes, uppercase micro-labels or other "AI-looking" formatting.
  - Tables and charts belong only in annexes, after the signature.
  - Write small numbers as words, give changes in words ("fallen by 27", not "-27"), and use standard estimative language.
- The owner likes to **see things work end-to-end** and prefers recommendations to long option lists.

---

## 3. Running it

**Two websites.**
- **Public website:** `app/kingdom-of-the-bleeding-heart.html`.
  - **Facts and directory:** it makes one request to `POST /nations` (`NATION` constant at the top of its script) and up to one `POST /towns` per 100 towns, to fill the Kingdom's figures and the "Towns of the Kingdom" directory (mayor, residents, public spawn).
  - **API failure:** if the API is unreachable, those sections say so and the rest of the page still works.
  - **Link:** a discreet "Government staff" link (header strip and footer) points to `earthmc-ruin-scanner.html` by relative path. Change both `href`s if the government site is hosted elsewhere or renamed.
- **Government website:** `app/earthmc-ruin-scanner.html` opens on a white sign-in page: the crest, the two ministries, and a "Public website" link back. Behind it are the dark ministries.

**Password.**
- Each ministry asks for the password **`putangina`**. The same password covers both, but each is unlocked separately; moving into the other ministry from the nav asks again.
- An unlock lasts for that browser tab only (sessionStorage key `bh_unlocked`). **Lock** in the top bar returns to the sign-in page. After five wrong attempts the form waits 30 seconds.
- After unlocking, the boot sequence plays and the chosen ministry's scan screen appears. If a saved scan exists, it also offers "Or open the latest intelligence".
- Only `sha256("bh-ministry:" + password)` is stored (`GATE_HASH` in the gate section). To change the password, compute the new hash and replace that value.
- This keeps casual visitors out. It is **not** real security: someone with developer tools can bypass it, and the browser archive is not encrypted. Real protection would need a server that checks the password before sending the page.
- Watch mode and Movement Watch start only after a ministry is unlocked.
- **Tests:** every government-site test except `portal-test.js` pre-unlocks the tab with `addInitScript`. `public-test.js` covers the public site.

- **Run the government site:** open `app/earthmc-ruin-scanner.html`, sign in to a ministry, in Chrome, Edge or Firefox and press **SCAN ALL TOWNS**. A scan takes about 20–60 s, paced to the API limit. It resumes if interrupted.
- **Saving:** each scan is saved to IndexedDB, so the site opens on the latest data next time.
- **Collecting around the clock:** turn on **Watch mode**, which rescans every N minutes while the page is open. The **Movement Watch** toggle also records live positions while the page is open.
- **Running the tests:**
  ```bash
  npm i playwright && npx playwright install chromium   # once
  bash tests/run-all.sh
  ```
  Each test prints `no errors` on success. The tests intercept `api.earthmc.net` and `map.earthmc.net`, so they need no network. `moves-test.js` and `deep-test.js` also write sample PDFs into `tests/`.

---

## 4. Main file structure (`app/earthmc-ruin-scanner.html`)

There is one `<style>` block, the HTML, and one `<script>`. Major sections are marked with `/* ---------- Name ---------- */` banners. The approximate line numbers below are as of handoff.

| ~Line | Section | Key functions |
|---|---|---|
| 773 | Data / scanning | `scan()`, `scanModel(details,lastOnline,premium,npc)` (town model, including `claims` and resident names in `people`), `hydrate(sv)` (restores a saved scan), `enterApp()` |
| 1045 | Warps | `setWarps`, `assignWarps`: nearest **funded** public town warp to each target |
| 1071 | Overclaim | `overclaim(t)`, `isOverclaimable`, `isOverTarget` |
| 1124 | Nation dossier | `buildNations`, `renderNations`, dossier panel |
| 1319 | Ruin rules | `etaOf`, `isSoon`, `isProtected`, `learnFromRuins()` (learns the inactivity limit and purge time from real ruins) |
| 1427 | Render | `render()`, which dispatches by page (`tab`) |
| 1655 | Map | Flat and globe views, Squaremap tile underlay, Earth outline, HQ marker. `drawMap()` runs every frame and has per-page layers |
| 2277 | Intel over time + War Room bridge | Trend charts, alliance web, `warRoomPackage` (the "Send to war room" JSON) |
| 2434 | Holographic player cards | `openHolo(name, town)`, skins from mc-heads.net |
| 2555 | Nation assessments | `assessAll(homeName)`, `assess(n, persp)`: risk, hostility, friendliness, strength 0–100, stance, flags. Cached per perspective |
| 2726 | Hand-written PDF writer | `makePdf()`, `briefingPdf(doc)`. Fonts: F1/F2 Helvetica, F3 Courier, F4/F5/F6 Times. Justified text through `Tw`; crest embedded as JPEG |
| 2990 | Intelligence archive (IndexedDB) | `archiveScan`, `loadArchive`, event diffing, `exportArchive` / `importArchive` |
| 3168 | Watch mode | `WATCH`, `scheduleWatch()` |
| 3185 | Analysis | `trend(name,key)`, `anticipate(n,p)` (scored courses of action), `threatsTo`, `eventsFor`, estimative language |
| 3312 | Briefing Room documents | `docBase`, prose helpers (`Para`, `Head`, `Annex`, `plural`, `moved`, …), `nationAssessment`, `supportAssessment`, `intsum`, movement prose, `docHtml`, `docText`, `downloadPdf` |
| 3759 | Forecast Lab | `ML_MODELS`, features, `outcomeOf`, `learn`, `mlScan()` (after each scan it resolves due forecasts and makes new ones), `loadML` |
| 3918 | Movement Watch | `MOVES`, `pollMoves`, `ingestMoves`, `closeVisit`, `visitFeatures`, `purposeOf`, `labelVisit`, `movePairs`, `pairFeatures`, `renderMoves`, `drawMovesLayer`, `RELAY_PY` |
| ~4570 | Government sign-in and ministry gate | `sha256`, `GATE_HASH`, `MINISTRY` (page → ministry), `askPassword`, `enterMinistry`, `setLandingFor`, `startCollection`; gated `hashchange` handler. Sign-in markup is the `#portal` and `#gate` blocks at the top of `<body>` |
| 4218+ | Events / page wiring | Briefing Room page, Forecast Lab page, `PAGES`, `setPage`, `pageFromHash`, boot IIFE |

**Watch for ordering problems.** Many `const` and `let` declarations are top-level. Code that runs at load time must come **after** the declarations it uses, or it throws a temporal dead zone error and the page fails to load. This bit several times during development. After any edit, `tests/err.js` catches load errors.

**Adding a page:**
1. Add an entry to `PAGES`.
2. Add a link in `<nav class="pages">`.
3. Map its hash in `pageFromHash`.
4. Add the page to `MINISTRY` in the gate section, so it is password-protected under the right ministry.
5. Add CSS show/hide rules (`body[data-page="x"] :is(.only-…)`, plus `.only-x` hidden on other pages).
6. Add a case in `render()`.
7. Add it to the intel-page lists in `setPage`.
8. Add a map layer branch in `drawMap()` if the page uses the map.

---

## 5. Data and rules

### EarthMC API v4
- `GET /towns` and `GET /nations` list names. `POST /towns`, `/players` and `/nations` take `{query:[names]}` in batches of up to 100.
- The rate limit is about 180 requests per minute. The scanner paces itself at about 150 per minute, with retries, backoff and resume. The resume cache lives in localStorage.
- A town supplies `coordinates.spawn`, `homeBlock` and `townBlocks` (chunk coordinates), `stats.balance`, `numTownBlocks`, `maxTownBlocks`, `status.isRuined` and `isPublic`.
- A player supplies `timestamps.lastOnline`, `status.isOnline` and NPC flags.

### Live map (Movement Watch)
- The live map is Squaremap at `https://map.earthmc.net`. Tiles are at `/tiles/{world}/{z}/{x}_{z}.png`, and live players at `/tiles/players.json` (`{players:[{name,x,z,world,…}]}`).
- **Not verified against the live server.** The build environment couldn't reach EarthMC. If the browser blocks the feed (CORS), the page offers `relay.py`.

### Game rules
- **Ruin:** a town ruins when no resident has logged in for 42 days. The limit is configurable and learned from real ruins; the daily purge time is learned too.
  - Premium, NPC-mayor and purge-survivor towns are treated as **Protected**, i.e. not trusted to fall.
- **Overclaim:** the claim limit is 8, plus 8 per active resident, plus the nation bonus (or the API's `maxTownBlocks`). Inactive residents stop counting.

### IndexedDB `bh-intel`, version 3
| Store | Contents |
|---|---|
| `meta` | `stats`, `frame` (latest), `lastScan` (full saved scan), `ml` (Forecast Lab state), `moveHours` (hours of movement collection) |
| `series` | Per-nation compacted time series. Each point is an array indexed by `PT = {at,a30,a7,res,towns,chunks,gold,allies,enemies,falling,take,dHQ,cx,cz}` |
| `frames` | One daily snapshot of every town and of alliances, keyed `YYYY-MM-DD` |
| `events` | Diffs between scans: `town_new`, `town_gone`, `town_ruin`, `town_switch`, `town_join`, `town_leave`, `land`, `mayor_change`, `nation_new`, `nation_gone`, `ally_add`, `ally_drop`, `enemy_add`, `enemy_drop`, `leader_change`, `capital_change`. Indexed on `at` |
| `predictions` | Forecast Lab forecasts `{model, subject, at, due, x, p, p0, status, y}`. Indexed on `status` |
| `visits` | Movement Watch visits `{at,end,dwell,player,pt,pn,town,nation,n,edge,spawn,warp,path,x,p,p0,purpose,label}`. Indexed on `at`; kept for 30 days |

The archive export and import (Briefing Room sidebar) carry series, frames, events and visits, so data can move between computers.

---

## 6. Machine learning (Forecast Lab)

- Each model is online logistic regression with AdaGrad and L2 regularisation. It starts from hand-set "prior" weights, which encode the rules.
- Every forecast stores its features `x`, the model's probability `p`, and the rules-only probability `p0`.
- When the outcome is known (from the event log, or from a user label for `scout`), the model takes one gradient step. It is then scored on its Brier score against the prior: "skill" means better than the starting rules.

| Model | Question | Horizon | Outcome source |
|---|---|---|---|
| `ruin72` | Town falls to ruin | 3 days | events + ruined flag |
| `loss7` | Nation loses a town | 7 days | events |
| `gain7` | Nation gains land | 7 days | events |
| `diplo7` | Alliance or enmity changes | 7 days | events |
| `leader7` | Leadership changes | 7 days | events |
| `probe7` | Hostile move after a day of incursions from nation A into B (enmity, broken alliance, town switch, land lost where visited) | 7 days | events |
| `scout` | A visit is reconnaissance | — | **user labels** on Movement Watch |

**Validation:** in a test with a hidden rule, `ruin72` reached a Brier score of 0.125 against 0.234 for the rules (+47% skill).

**Model use elsewhere:** `anticipate()` blends model probabilities into its courses of action once a model has enough checked forecasts, with weight `min(1, n/50)`.

**Adding a model:**
1. Add an entry to `ML_MODELS` (names and priors).
2. Add a case in `featuresFor`.
3. Add an outcome branch in `outcomeOf`.
4. Add a generation step in `mlScan`.

`loadML()` resets the saved state for any model whose weight length changes.

---

## 7. Briefings (Briefing Room → PDF)

There are three document types, each built as one structure that renders both on screen (`docHtml`) and as a PDF (`briefingPdf`):
- **Intelligence Assessment** (one nation, from any perspective):
  - Summary, Key Judgments, Background
  - Leadership, Territory, Economy, Foreign Relations
  - Movements and Reconnaissance
  - Military Potential, Vulnerabilities, Outlook and Scenarios
  - Implications, Recommendations (internal only), Intelligence Gaps
  - Annexes A–D: stats table, trend charts, town register, recorded visits
- **Support Assessment** (written for an ally): risks, threats (including their incursions), holdings at risk, actions.
- **Daily Intelligence Summary**: the whole server over the last 24 hours, including movements and the 72-hour forecast.

**Classification:**
- **Kingdom eyes only** (crimson): includes recommendations and target lists.
- **Releasable to allies** (blue, watermarked): drops them.

**Section types:** `h` (numbered heading), `p` (`num:false` for an unnumbered aside), `annex`, `table`, `chart`, plus legacy `bullets` and `note`.

---

## 8. War Room (hosted shared page)

- **Published at:** https://claude.ai/artifact/DrxXKg6uDf1GANPMDZcdWH (owned by the user's claude.ai account). `app/war-room.html` is its source.
- **Runtime:** it uses the claude.ai artifact runtime capabilities `db`, `user` and `room` through `claude.use(...)`. Outside claude.ai those resolve to nothing, so the page shows but can't save. To host it elsewhere, replace the `db` and `user` calls with your own backend (for example Firebase or Supabase).
- **Tabs:** board (target claims with leases), intel (trends and stance from imported scans), notes (named alliances and plans, autosaved), import.
- **Data flow:** hosted pages can't call outside hosts, so the main site's **"Send to war room"** button copies a JSON package (`kind:"bleeding-heart-intel"`), which is pasted into the War Room's import tab.

---

## 9. Known limits

- **Collection only while the page is open.** Watch mode and Movement Watch both need the page running. A cloud collector was planned, but the build environment's network policy blocked `api.earthmc.net`. A small server or cron job (Node or Python) that calls the API and writes the same archive format would make collection truly 24/7.
- **Movement Watch is untested against the real feed.** Players can hide from the live map, so absence is not evidence. Claim matching falls back to an approximate square when a town's `townBlocks` aren't provided.
- **The single 480 KB file is hard to edit by hand.** Splitting it into modules with a bundler that inlines into one HTML would help, if the owner still gets a single standalone file.

---

## 10. Next steps the owner asked about

1. **Chat intelligence (next planned feature)**
   - **Minecraft chat:**
     - **Source:** the owner's own client log (`.minecraft/logs/latest.log`, plus gzipped older logs). Add an "Import chat log" button that parses it locally; no mod is needed.
     - **Extraction:** pull out timestamps, channel prefixes (town, nation, global), speakers and message text.
   - **Discord:** use a bot (Message Content intent) in servers where the owner is an admin or invited, forwarding messages to an export the site can import.
     - Do **not** use self-bots or user-account scraping, which breaks Discord's terms.
     - The EarthMC API v4 `/discord` endpoint can link Discord IDs to Minecraft accounts.
   - **Analysis:**
     - Recognise mentions of nations, towns and players and link them to scan data.
     - Rate tone and intent (hostile, recruiting, war talk, trade).
     - Build a timeline beside archive events.
     - Feed signals into Forecast Lab features (for example "chatter about X in the last 48h" for `diplo7` and `probe7`).
     - Add a "Signals" section to briefings.
     - Claude via the Anthropic API could classify and summarise messages; that requires an API key held server-side, never in the HTML.
2. **Optional:**
   - a true 24/7 collector
   - War Room integration of movement data
   - movement data in the War Room package
3. **Hourly server (owner's chosen next step):**
   - **What:** a small always-on server, for example Node on Railway with a persistent volume, that scans the EarthMC API every hour and keeps the archive (SQLite or equivalent).
   - **Serving:** it serves the public site and the ministries.
   - **Login:** the ministry password is checked on the server.
   - **Import:** browser archives exported from Watch mode should be importable, so earlier collection isn't lost.
   - **Owner's side:** the owner has GitHub and will connect a repository for deployment.
4. **Operations page (requested):** a Ministry of Attack page for planning ruin raids and overclaims. Each operation holds its target towns (with live status from the latest scan), scheduled time, rally point and route, team, supplies checklist, personal notes, a timestamped log and an after-action record. Store it in IndexedDB and include it in archive export and import.

