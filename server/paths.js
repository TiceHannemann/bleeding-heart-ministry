const fs = require("fs");
const path = require("path");

// DATA_DIR should be a persistent volume on the host (Railway: mount a volume at /data)
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const APP = path.resolve(__dirname, "..", "app");
const ASSETS = path.resolve(__dirname, "..", "assets");
fs.mkdirSync(DATA, { recursive:true });

const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
// write to a temporary file first, so a crash never leaves half a file behind
const writeJSON = (f, v) => { fs.writeFileSync(f + ".tmp", JSON.stringify(v)); fs.renameSync(f + ".tmp", f); };

module.exports = { DATA, APP, ASSETS, readJSON, writeJSON };
