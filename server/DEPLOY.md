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
   - `MINISTRY_PASSWORD`: the ministry password. Choose a new one; without it the old built-in password works.
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

## Bringing over earlier collection

In a browser that ran Watch mode, open the Briefing Room and export the archive, then on `/gov/reports` press **Send an archive to the server**. It is merged at the next hourly scan.

## Things to know

- **Your browser follows the server.** When a new hourly scan is loaded, the browser's own scans, series and forecasts are replaced by the server's. Movement Watch visits recorded in your browser are kept.
- **Movement Watch still only records while a page is open.** The hourly collector doesn't poll the live map; that would be the next addition.
- **Rate limit.** A scan uses about the same number of requests as a manual one (paced at 150 a minute), once an hour.
