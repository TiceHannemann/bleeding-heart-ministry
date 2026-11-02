// The War Room: waypoints, routes, targets, danger marks, rally points and notes drawn on the map, shared live.
// Everyone's page asks for changes every few seconds (GET /api/warroom?rev=N), so a mark made by one officer appears on
// every open map within moments. Plans are kept on the data volume and survive restarts.
// Reading is open to anyone who can open the ministries; changing needs the site password (when one is set) or the
// war room key, WARROOM_KEY (or, when that isn't set, CHAT_UPLOAD_TOKEN), so a stranger with the link cannot draw on it.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DATA, readJSON, writeJSON } = require("./paths");

const DIR = path.join(DATA, "warroom");
fs.mkdirSync(DIR, { recursive:true });
const FILE = path.join(DIR, "ops.json");
const KINDS = ["waypoint", "route", "target", "danger", "rally", "note"];
const MAX_ITEMS = 2000, KEEP_LOG = 300;

// items: { id, kind, name, note, pts:[[x, z], ...], by, at, upd, done }; log: [at, who, what, name]
const state = Object.assign({ rev:0, items:[], log:[] }, readJSON(FILE) || {});
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJSON(FILE, state), 300); };

const key = () => process.env.WARROOM_KEY || process.env.CHAT_UPLOAD_TOKEN || "";
function keyOk(given) {
  const k = key(); if (!k || typeof given !== "string" || given.length !== k.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(k));
}
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
function clean(it) {
  if (!it || !KINDS.includes(it.kind)) throw new Error("Unknown kind of mark.");
  const pts = (Array.isArray(it.pts) ? it.pts : []).slice(0, 200).map(p => [Math.round(+p[0]), Math.round(+p[1])]).filter(p => p.every(Number.isFinite) && Math.abs(p[0]) < 2e5 && Math.abs(p[1]) < 2e5);
  if (!pts.length || (it.kind === "route" && pts.length < 2)) throw new Error(it.kind === "route" ? "A route needs at least two points." : "A mark needs a place.");
  return { kind:it.kind, name:str(it.name, 80) || it.kind[0].toUpperCase() + it.kind.slice(1), note:str(it.note, 1000), pts:it.kind === "route" ? pts : [pts[0]], done:!!it.done };
}
function change(op, it, who) {
  who = str(who, 32) || "Unknown";
  const now = Date.now();
  if (op === "add") {
    if (state.items.length >= MAX_ITEMS) throw new Error("The War Room is full; clear some old marks first.");
    const x = { id:crypto.randomBytes(6).toString("hex"), ...clean(it), by:who, at:now, upd:now };
    state.items.push(x); state.log.push([now, who, "added", x.name]);
  } else {
    const i = state.items.findIndex(x => x.id === it?.id); if (i < 0) throw new Error("That mark no longer exists.");
    if (op === "delete") { state.log.push([now, who, "removed", state.items[i].name]); state.items.splice(i, 1); }
    else if (op === "update") { const x = state.items[i]; Object.assign(x, clean({ ...x, ...it, kind:x.kind }), { upd:now, updBy:who }); state.log.push([now, who, x.done ? "marked done" : "changed", x.name]); }
    else throw new Error("Unknown change.");
  }
  state.log = state.log.slice(-KEEP_LOG); state.rev++; save();
  return state.rev;
}
// a page that already has revision `rev` gets nothing back but the number
const read = rev => +rev === state.rev ? { rev:state.rev, same:true } : { rev:state.rev, items:state.items, log:state.log.slice(-60) };
module.exports = { read, change, keyOk, hasKey:() => !!key(), _state:state };
