// The War Room: the Ministry of Attack's shared plan, live for every officer.
// - marks: waypoints, routes, targets, danger marks, rally points and notes drawn on the map;
// - raids: the raid board, towns to hit (ruins about to fall, land to overclaim, scouting), claimed by one officer at a
//   time and logged when done with what was taken;
// - plans: written plans, named alliances and notes, edited by anyone and saved as they type.
// Everyone's page asks for changes every few seconds (GET /api/warroom?rev=N), so a change made by one officer appears
// on every open page within moments. The plan is kept on the data volume and survives restarts.
// Reading is open to anyone who can open the ministries; changing needs the site password (when one is set) or the
// war room key, WARROOM_KEY (or, when that isn't set, CHAT_UPLOAD_TOKEN), so a stranger with the link cannot change it.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DATA, readJSON, writeJSON } = require("./paths");

const DIR = path.join(DATA, "warroom");
fs.mkdirSync(DIR, { recursive:true });
const FILE = path.join(DIR, "ops.json");
const KINDS = ["waypoint", "route", "target", "danger", "rally", "note"];
const RAID_KINDS = ["ruin", "overclaim", "scout", "other"], PLAN_KINDS = ["plan", "alliance", "note"];
const PLAN_STATUS = ["idea", "planned", "active", "done", "dropped"];
const MAX_ITEMS = 2000, MAX_RAIDS = 1500, MAX_PLANS = 500, KEEP_LOG = 300;

// items: { id, kind, name, note, pts:[[x, z], ...], by, at, upd, done }
// raids: { id, kind, town, nation, x, z, eta, chunks, gold, warp, note, status:"open"|"claimed"|"done", claimedBy, loot, taken, doneAt, by, at, upd }
// plans: { id, kind, title, body, nations:[], status, due, pinned, by, at, upd, updBy }
// log: [at, who, what, name]
const state = Object.assign({ rev:0, items:[], raids:[], plans:[], log:[] }, readJSON(FILE) || {});
state.raids ||= []; state.plans ||= [];
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJSON(FILE, state), 300); };

const key = () => process.env.WARROOM_KEY || process.env.CHAT_UPLOAD_TOKEN || "";
function keyOk(given) {
  const k = key(); if (!k || typeof given !== "string" || given.length !== k.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(k));
}
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const text = (v, n) => String(v ?? "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, n);
const num = (v, lo, hi) => v == null || v === "" || !Number.isFinite(+v) ? null : Math.min(hi, Math.max(lo, Math.round(+v)));
const newId = () => crypto.randomBytes(6).toString("hex");

function cleanMark(it) {
  if (!it || !KINDS.includes(it.kind)) throw new Error("Unknown kind of mark.");
  const pts = (Array.isArray(it.pts) ? it.pts : []).slice(0, 200).map(p => [Math.round(+p[0]), Math.round(+p[1])]).filter(p => p.every(Number.isFinite) && Math.abs(p[0]) < 2e5 && Math.abs(p[1]) < 2e5);
  if (!pts.length || (it.kind === "route" && pts.length < 2)) throw new Error(it.kind === "route" ? "A route needs at least two points." : "A mark needs a place.");
  return { kind:it.kind, name:str(it.name, 80) || it.kind[0].toUpperCase() + it.kind.slice(1), note:str(it.note, 1000), pts:it.kind === "route" ? pts : [pts[0]], done:!!it.done };
}
function cleanRaid(it) {
  if (!it || !RAID_KINDS.includes(it.kind)) throw new Error("Unknown kind of raid.");
  const town = str(it.town, 60); if (!town) throw new Error("A raid needs a town.");
  return { kind:it.kind, town, nation:str(it.nation, 60), x:num(it.x, -2e5, 2e5), z:num(it.z, -2e5, 2e5), eta:num(it.eta, 0, 1e14), chunks:num(it.chunks, 0, 1e5),
    gold:num(it.gold, 0, 1e9), warp:str(it.warp, 60), note:str(it.note, 300) };
}
function cleanPlan(it) {
  if (!it || !PLAN_KINDS.includes(it.kind)) throw new Error("Unknown kind of plan.");
  const nations = [...new Set((Array.isArray(it.nations) ? it.nations : []).map(x => str(x, 60)).filter(Boolean))].slice(0, 40);
  return { kind:it.kind, title:str(it.title, 120), body:text(it.body, 20000), nations, status:PLAN_STATUS.includes(it.status) ? it.status : "idea",
    due:/^\d{4}-\d{2}-\d{2}$/.test(it.due || "") ? it.due : "", pinned:!!it.pinned };
}

const COLL = {
  marks:{ list:() => state.items, max:MAX_ITEMS, clean:cleanMark, name:x => x.name, full:"The War Room is full; clear some old marks first." },
  raids:{ list:() => state.raids, max:MAX_RAIDS, clean:cleanRaid, name:x => x.town, full:"The raid board is full; delete some old raids first." },
  plans:{ list:() => state.plans, max:MAX_PLANS, clean:cleanPlan, name:x => x.title || "an untitled " + x.kind, full:"There are too many plans; delete some old ones first." },
};
function change(op, it, who, coll = "marks") {
  const C = COL(coll); who = str(who, 32) || "Unknown";
  const now = Date.now(), list = C.list(), log = (what, x) => state.log.push([now, who, what, (coll === "raids" ? "raid on " : "") + C.name(x)]);
  if (op === "add") {
    if (list.length >= C.max) throw new Error(C.full);
    const x = { id:newId(), ...C.clean(it), by:who, at:now, upd:now };
    if (coll === "raids") { if (list.some(r => r.status !== "done" && r.town.toLowerCase() === x.town.toLowerCase())) throw new Error(`${x.town} is already on the board.`); Object.assign(x, { status:"open", claimedBy:null }); }
    list.push(x); log("added", x);
  } else {
    const i = list.findIndex(x => x.id === it?.id); if (i < 0) throw new Error("That no longer exists. Someone may have removed it.");
    const x = list[i];
    if (op === "delete") { log("removed", x); list.splice(i, 1); }
    else if (op === "update") {
      // a plan edited by two officers at once: the second save is refused rather than overwriting the first
      if (coll === "plans" && it.ver != null && +it.ver !== x.upd) throw new Error(`${x.updBy || x.by} changed this plan a moment ago. Their version is shown now.`);
      Object.assign(x, C.clean({ ...x, ...it, kind:x.kind }), { upd:now, updBy:who });
      if (coll === "marks") log(x.done ? "marked done" : "changed", x); else if (coll === "plans") { if (now - (x.logged || 0) > 10 * 6e4) { log("edited", x); x.logged = now; } } else log("changed", x);
    }
    // the raid board: one officer at a time on a raid. The server decides, so two officers can't both claim the same town.
    else if (coll === "raids" && op === "claim") { if (x.status !== "open") throw new Error(x.status === "claimed" ? `${x.claimedBy} has already claimed ${x.town}.` : `${x.town} is already done.`); Object.assign(x, { status:"claimed", claimedBy:who, upd:now }); log("claimed", x); }
    else if (coll === "raids" && op === "release") { if (x.status !== "claimed") throw new Error(`${x.town} isn't claimed.`); log(x.claimedBy === who ? "released" : `released ${x.claimedBy}'s claim on`, x); Object.assign(x, { status:"open", claimedBy:null, upd:now }); }
    else if (coll === "raids" && op === "done") {
      Object.assign(x, { status:"done", claimedBy:x.claimedBy || who, loot:str(it.loot, 200), taken:num(it.taken, 0, 9999), doneAt:now, upd:now });
      state.log.push([now, x.claimedBy, "raided", x.town + (x.loot ? `, took ${x.loot}` : "") + (x.taken ? `, ${x.taken} chunks` : "")]);
    }
    else if (coll === "raids" && op === "reopen") { Object.assign(x, { status:"open", claimedBy:null, loot:"", taken:null, doneAt:null, upd:now }); log("reopened", x); }
    else throw new Error("Unknown change.");
  }
  // finished raids are kept for 30 days, for the tally
  state.raids = state.raids.filter(r => r.status !== "done" || now - r.doneAt < 30 * 864e5);
  state.log = state.log.slice(-KEEP_LOG); state.rev++; save();
  return state.rev;
}
function COL(coll) { const C = COLL[coll || "marks"]; if (!C) throw new Error("Unknown part of the War Room."); return C; }
// a page that already has revision `rev` gets nothing back but the number
const read = rev => +rev === state.rev ? { rev:state.rev, same:true } : { rev:state.rev, items:state.items, raids:state.raids, plans:state.plans, log:state.log.slice(-60) };
module.exports = { read, change, keyOk, hasKey:() => !!key(), _state:state };
