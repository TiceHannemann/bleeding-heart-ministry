#!/usr/bin/env bash
# Runs every regression test. Needs Node 18+ and Playwright with Chromium (npm i playwright && npx playwright install chromium).
# Each test serves a fake EarthMC API, so no network access is needed. Each prints "no errors" on success (err.js prints nothing when the page loads cleanly).
cd "$(dirname "$0")"
for t in err.js public-test.js portal-test.js landing.js holo-test.js intel2.js deep-test.js ml-test.js moves-test.js war-room-test.js; do
  echo "== $t"; node "$t" 2>&1 | grep -v ERR_TUNNEL | tail -3
done
