# The Agent Heart relay contract

How Discord intelligence reaches this repository, what the files mean, and what an implementing
agent is expected to do with them. Read this before touching anything under `intel/`.

## Why it exists

On EarthMC, treaties, denouncements, cabinet appointments and government announcements are routinely
posted as **screenshots**, not text. A collector that only reads message text sees a one-line caption
("**Sumer Denounces Persia** — Tags: `conflict`") and misses the entire document behind it. The relay
therefore treats the image as the primary source and the message text as metadata.

## The pipeline

```
Bleeding_heart collection server (Discord)
        │   owner "Follows" announcement channels from EarthMC nation servers
        │   into #chat-a / #chat-b / #chat-c
        ▼
tools/agent-heart-relay.mjs          ← deterministic, no model, safe to re-run
        │   reads new messages via Discord REST (bot token)
        │   downloads image attachments
        ▼
intel/inbox/raw/<message_id>.json    ← one file per message, staged for analysis
intel/attachments/<message_id>-<name>.png
        │
        ▼
Hermes cron job "Agent Heart"        ← the analysis half (vision OCR + judgement)
        │   OCRs every image, classifies, discards noise
        ▼
intel/inbox/items/<item_id>.json     ← normalised intelligence records
        │
        ▼
implementing agent (Claude Code)     ← folds them into the site's briefings
        ▼
intel/inbox/processed/               ← items are moved here once implemented
```

**Hard constraint:** a Discord bot can only read servers it has been installed in. Agent Heart is in
`Bleeding_heart` and nothing else. It cannot read an EarthMC community server directly unless an
administrator there invites it. The **Follow** mechanism is what makes this work: the owner follows a
channel in someone else's server, and Discord copies every new post into the owner's own server as a
webhook message, which Agent Heart *can* read. No second invite is needed, and no self-bot.

## Running the collection half

```bash
export DISCORD_BOT_TOKEN=...                      # or --token-file <path to a .env>
node tools/agent-heart-relay.mjs                  # incremental; uses the cursor in state.json
node tools/agent-heart-relay.mjs --backfill 40    # first run: take the newest 40 per channel
node tools/agent-heart-relay.mjs --dry            # show what would be staged, write nothing
node tools/agent-heart-relay.mjs --guild <id> --out <dir>
```

It is idempotent: `intel/state.json` holds the newest message id seen per channel, and only messages
after it are fetched. Attachments already on disk are not re-downloaded. A channel named `test` is
excluded by default (`AH_EXCLUDE` overrides). Images over 8 MB are skipped.

## `raw/` — the staging format

One JSON object per Discord message. Written by the relay, read by the analysis half.

| Field | Meaning |
|---|---|
| `message_id` | Discord snowflake. The filename, and the dedupe key. |
| `channel` | `{id, name, type}` of the collection channel it landed in. |
| `posted_at` | ISO timestamp of the original post. |
| `forwarded` | `true` when the message arrived by channel-follow rather than being typed. |
| `source` | `{guild_id, channel_id, label, channel}` — where the post originally came from. For a follow, `label` is the source server and `channel` the source channel name, recovered from the webhook author (`"The Nostra Times News #nostra-times"`). |
| `author` | `{id, name, bot, webhook}`. |
| `text` | The message text, with Discord emoji markup normalised and embeds folded in. Frequently a one-line caption. |
| `url` | Permalink in the collection server. |
| `attachments[]` | `{filename, size, url, saved}` where `saved` is a repo-relative path under `intel/attachments/`. |
| `reactions` | Total reaction count — a rough public-interest signal. |

**Not every raw record is intelligence.** Follow-notification messages (`type: 12`, posted by the
owner, reading e.g. `"Cuba #nation-announcements"`) are Discord telling you a channel is now being
mirrored. They carry no content and must be discarded during analysis, not turned into items.

## `items/` — the intelligence format

One JSON object per **event**, not per message: a single announcement can yield several items (a
denouncement also implies a town defection; a departure also implies a recruitment opening). The
schema deliberately mirrors the event object in `server/signals.js`, so an item can be handed to the
site's own signals store without translation.

```jsonc
{
  "item_id":      "bh-<yyyymmdd>-<message_id>-<slug>",  // stable; the processed/ filename
  "captured_at":  "ISO — when the analysis half wrote this",
  "type":         "alliance | non_aggression_pact | war_or_hostility | peace_or_truce |
                   merger_or_annexation | town_transfer | raid_or_attack_plan | recruitment |
                   sanctions_or_trade | leadership_or_internal | server_news | other_intel",
  "nations":      ["Sumer", "Persia"],       // exact EarthMC nation names where they match
  "summary":      "One sentence, past tense, formal English, as in a government report.",
  "confidence":   "low | moderate | high",
  "status":       "announced_officially | reported | rumoured | denied",
  "importance":   4,                          // 1 minor .. 5 changes the balance of power
  "at":           "ISO — timestamp of the underlying post, not of capture",
  "tags_from_source": ["conflict"],           // the source outlet's own tags, for cross-checking
  "sources": [{
    "message_id": "...", "url": "...",
    "origin": "The Nostra Times News #nostra-times",
    "origin_guild_id": "...", "origin_message_id": "...",
    "relayed_via": "#chat-a", "posted_at": "...",
    "attachment": "intel/attachments/....png",
    "extraction": "vision-ocr"
  }],
  "evidence": {
    "document_type": "...", "issuing_authority": "...",
    "key_text": "verbatim quotes that carry the judgement",
    "trigger": "...", "timing": "...", "reactions": "...",
    "ocr_notes": "misreadings, ambiguities, uncertain names",
    "full_transcription": "the complete OCR text, for the record"
  },
  "analyst_notes":   "Reasoning: what is claimed vs what is known, who benefits from the framing, what to watch next.",
  "why_it_matters":  "One line. Why this deserves a place in a briefing at all.",
  "links_to_scan_data": ["Sumer", "Parthia"]   // names to check against the scan archive
}
```

### Rules for the analysis half

- **The image is the source; the caption is metadata.** A caption reading "Tags: `conflict`" is the
  outlet's classification, not a finding. `tags_from_source` preserves it for cross-checking, and it
  is often right, but it is not evidence.
- **Never invent a nation name.** Use the name exactly as EarthMC spells it when it matches one;
  otherwise leave it out of `nations` and mention it in `analyst_notes`.
- **Separate claim from knowledge.** An adversary's statement about another nation's inactivity is a
  claim. Say so in `analyst_notes`, and name the check that would settle it.
- **Discard, loudly.** Memes, greetings, small talk, giveaways, real-world politics and
  follow-notification stubs produce no item. Returning nothing for a batch is the normal case.
- **Preserve the transcription.** `full_transcription` is the evidence of record — the image itself
  may be deleted from Discord later.
- **`confidence` is about the source, not the importance.** An official government communiqué is
  `high` confidence even when it is a minor matter; a rumour is `low` however consequential.

## What the implementing agent does

1. `git pull`, then run the relay.
2. Read `intel/inbox/items/*.json` not already in `processed/`.
3. For each item, decide how it lands in the site:
   - **Signals** — items are already in `server/signals.js` shape. To feed the live site, run
     `node tools/send-intel.mjs --server http://SITE:8080 --token-file .env`. It POSTs `{ items:[...] }`
     to `/api/chat-import` with the `x-chat-token` header (the token is `CHAT_UPLOAD_TOKEN`; never commit
     it). The server merges them straight into the signals store, with no model needed, so they appear in
     the Daily Intelligence Summary and in each named nation's assessments within minutes. The tool then
     moves the sent items to `processed/`. Sending the same item twice does nothing.
   - **Briefings** — fold material into the relevant document type in `app/earthmc-ruin-scanner.html`
     (Intelligence Assessment, Support Assessment, Daily Intelligence Summary) following the house
     style in `CLAUDE.md`. Respect the classification: nothing from `intel/` in a *releasable* report.
   - **Contact register** — cabinet appointments and named points of contact update who speaks for a
     nation. These are cheap and useful even when the news is not.
4. Move implemented items to `intel/inbox/processed/`. Leave unimplemented ones in place; they are
   the queue.
5. Commit with a message naming the items, e.g. `intel: Sumer–Persia severance, Gulf Union exit`.

## Housekeeping

- `intel/attachments/` holds binary evidence and will grow. It is committed on purpose — the images
  are the primary source and Discord CDN links expire. Prune anything older than 90 days whose item
  has been processed.
- `intel/state.json` is a cursor, not a record. It is safe to delete to force a re-read.
- Never commit `intel/` material into a repository that is **public** unless the owner has accepted
  that named players, accusations and screenshots become public. See `intel/README.md`.
