// EarthMC's in-game chat bridge posts each player kill to Discord as "☠ Victim was killed by Killer".
// Shared by server/combat.js and tools/discord-kills.js. Returns [killer, victim], or null for anything else.
const NAME = /^[A-Za-z0-9_]{2,16}$/;
// the bridge's own form first, then the vanilla death messages that name a player, in case it ever uses them
const DEATH = /^☠?\s*([A-Za-z0-9_\\]{2,20}) (?:was (?:killed|slain|shot|blown up|fireballed|pummeled|impaled|skewered|squashed|stung|frozen) by|was killed (?:by magic )?whilst trying to escape|walked into (?:fire|danger zone) whilst fighting|hit the ground too hard whilst trying to escape|was knocked into the void by|drowned whilst trying to escape|burned to death whilst fighting|went off with a bang whilst fighting|tried to swim in lava to escape) ([A-Za-z0-9_\\]{2,20})(?: using .*)?$/;
function parseDeath(text) {
  const m = DEATH.exec(String(text || "").trim()); if (!m) return null;
  const v = m[1].replace(/\\/g, ""), k = m[2].replace(/\\/g, ""); // Discord escapes underscores in names
  return NAME.test(v) && NAME.test(k) && v !== k ? [k, v] : null;
}
module.exports = { parseDeath, NAME };
