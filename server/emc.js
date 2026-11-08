// The EarthMC API key on every request. From 19 November 2026 EarthMC refuses requests without a key on every
// endpoint, not only the keyed ones. A key is made in game with `/api key create`, belongs to one player and is read
// from the EMC_KEY setting; it stays on the server and never reaches a browser, the archive or an error message.
// It is sent the two ways EarthMC reads it: the Authorization header (as /events has always needed) and, on a POST,
// a "key" field in the JSON body (as /shop, /mcmmo, /mcmmo-top and /pursuits have always needed).
const API = (process.env.EMC_API || "https://api.earthmc.net/v4").replace(/\/+$/, "");
const KEY = (process.env.EMC_KEY || "").trim();

const headers = (extra = {}) => ({ "User-Agent":"BleedingHeart-Ministry", ...(KEY ? { Authorization:"Bearer " + KEY } : {}), ...extra });
// a POST body with the key added (a body that already names one keeps it)
const withKey = b => KEY && b && typeof b === "object" && !Array.isArray(b) && !("key" in b) ? { ...b, key:KEY } : b;

// one request to the API: GET without a body, POST with one
const emcFetch = (p, body, ms = 30e3) => fetch(API + p, { method:body ? "POST" : "GET", headers:headers({ "Content-Type":"application/json" }),
  body:body ? JSON.stringify(withKey(body)) : undefined, signal:AbortSignal.timeout(ms) });

// The page the collector runs calls the API itself. Its requests are given the key on their way out, so the page
// never holds it. Call this after any other routes: a fallback hands the request, key added, to the next handler,
// or to the network when there is none.
async function keyPage(ctx) {
  if (!KEY) return;
  await ctx.route(/^https:\/\/api\.earthmc\.net\//, r => {
    const q = r.request();
    if (q.method() === "OPTIONS") return r.fallback();
    let postData;
    if (q.method() === "POST") try { postData = JSON.stringify(withKey(JSON.parse(q.postData() || "null"))); } catch {}
    return r.fallback({ headers:{ ...q.headers(), Authorization:"Bearer " + KEY }, ...(postData ? { postData } : {}) });
  });
}

if (!KEY) console.warn("EarthMC API key missing (EMC_KEY): from 19 November 2026 EarthMC refuses every request without one. Make one in game with /api key create.");

module.exports = { API, KEY, headers, withKey, emcFetch, keyPage };
