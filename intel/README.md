# `intel/` — Discord intelligence relay

Machine-readable staging area for intelligence collected by **Agent Heart**, the Hermes Discord bot,
from the `Bleeding_heart` collection server. See `RELAY-CONTRACT.md` for the full specification.

| Path | What it is |
|---|---|
| `state.json` | Cursor: newest message id already read, per channel. |
| `attachments/` | Downloaded images. **The primary source** — treaties are posted as screenshots. |
| `inbox/raw/` | One record per Discord message, written by `tools/agent-heart-relay.mjs`. Not yet analysed. |
| `inbox/items/` | Normalised intelligence records, written by the analysis half. The queue for implementation. |
| `inbox/processed/` | Items already folded into the site. |
| `inbox/DIGEST.md` | Human-readable view of the current batch. |

## Running it

```bash
export DISCORD_BOT_TOKEN=...           # Agent Heart's token; lives in Hermes .env
node tools/agent-heart-relay.mjs
```

## ⚠️ Before this goes into a public repository

This repository is **public**. `intel/` contains raw Discord material: named players, quoted
accusations, and screenshots of documents from other nations' servers. `AGENT-HANDOFF.md` is explicit
that sources and methods — which servers are read, named players' movements, collection hours — are
**omitted from releasable reports**.

Putting the relay in the public repo therefore publishes the Kingdom's sources and methods. The
recommended arrangement is a **separate private repository** (for example `bleeding-heart-intel`) as
the relay, with this public repo consuming only sanitised output. The relay works unchanged against
either target — point it somewhere else with `--out`, or run it from a clone of the private repo.

If the owner deliberately chooses to keep `intel/` in this public repo, that choice should be recorded
here, because it is a decision about exposing sources, not a technical one.
