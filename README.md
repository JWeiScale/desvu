# Dès vu

> **Jason’s Mac version:** Finance has been removed from the app and search. Today supports
> **ML Systems** and **Reinforcement Learning**, alongside Recruiting, School, and Personal.
> These categories work for new tasks, edits, recurring tasks, and time estimates.
> Existing finance data is retained for compatibility; no saved records are deleted.
>
> The desktop app works locally. Telegram and Google Calendar require separate setup.
> The public source does not include the Claude `/sort-inbox` skill or its scripts;
> automatic sorting is unavailable until those are supplied. Synthesis reads existing
> weekly notes; generating summaries and asking the vault questions are not wired up.

A personal second brain. **One corpus, many inputs.**

An Obsidian vault of markdown and JSON is the single source of truth. Three things read it:
this Electron app, Obsidian itself, and Claude Code. Nothing is locked in a database, and
every record stays a file you can open, grep, or edit by hand.

Built for a student navigating school and tech recruiting, but nothing here is specific to
that beyond the category labels.

---

## The idea

Most personal-knowledge tools are strong at capture and weak at recall, so they quietly
become write-only. Dès vu splits the problem:

- **Capture is dumb, instant, and cannot fail.** A Telegram bot appends whatever you send
  to an Inbox file and stops. No parsing, no classification, nothing that can reject input.
- **Sorting is smart and happens later.** A Claude skill reads those raw lines and files
  each one where it belongs — a todo, a purchase, a meal, a workout, an article to read, a
  thought to keep.

The split is the whole design. A capture can never be lost because classification failed;
the worst case is a line waits in the Inbox a while.

---

## What it does

### Capture — from anywhere, laptop closed

Text the Telegram bot and it lands in `Inbox/YYYY-MM-DD.md` within a second:

```
- [ ] 14:32 · telegram · spent 20 on lunch at tepper
```

- **Works while the machine is asleep.** Telegram queues updates for 24 hours and delivers
  them when the bot reconnects. No webhook, no public endpoint, no tunnel.
- **Voice notes** are saved to `Attachments/` and transcribed locally via `whisper.cpp`. No
  cloud transcription API is used. Without a transcriber installed they are marked
  `[voice, untranscribed]` rather than silently dropped.
- **Photos** are saved and OCR'd locally via `tesseract`, with the extracted text on the line.
- **Desktop quick capture** (`⌘⇧Space`) writes the identical format.
- **Locked to one Telegram user id.** Anyone else gets no reply, no write, and a redacted
  log line.
- **The journal is unreachable from Telegram.** Reflection happens in the app only.

### Sorting — one command, or one button

`/sort-inbox` in Claude Code, or the **Sort inbox** button in the app, routes everything:

| You send | Where it goes |
|---|---|
| a link worth reading | `Library/` → the Explore tab, with an estimated read time |
| "spent 20 on lunch at tepper" | `finance.json` — amount, category, description |
| "ate a chipotle bowl" | `meals.json` — calories and protein estimated, flagged as a guess |
| "finished push day, 65 min" | `workouts.json` |
| "need to do the stripe OA before friday" | `todos.json` — category, priority, estimate, due date |
| a thought or observation | `Brain Dump/<topic>/<thread>.md`, appended to an existing thread |

It infers more than you'd expect: a meal captured at 19:40 is filed as dinner, and *"before
friday"* resolves against the capture date. Ambiguous lines are asked about in one batch
rather than interrupting repeatedly, and running it twice never files anything twice.

### Seven surfaces

**Today** — the default. A full-width day timeline with your calendar and todos placed into
the gaps, a *"Next — 15-451 lecture, 10am, in 40m"* line above it, and a **won't fit today**
tray for the overflow. You see which tasks don't fit rather than being told you're over.
Todos group by category and sort by priority, with estimate-vs-actual calibration that stays
quiet until it has enough data to be trustworthy (~25 completions in a category).

**Calendar** — day, week, and month views with tasks scheduled at exact dates/times.
Drag tasks to reschedule them, and import selected Google calendars from multiple
accounts. Google events are read-only. See [Calendar setup](docs/calendar.md).

**Journal** — a 1–7 rating and nothing else on open. A rating alone is a complete entry;
the four prompts are progressive disclosure behind *"Say a little more ↓"*.

**Explore** — the read-later library, filterable by type, status, tag and source, with a
*"what fits right now"* view that reads the free minutes Today already computed. Unread
items step out of the queue after 30 days without leaving the vault, the graph, or search.

**Meals & training** — free-text logging where calories and protein are optional. Targets
start off, so the app just logs and shows trends until you ask for a line to hit.

**Brain dump** — threads by topic, each a running document appended to over time rather
than a file per day. `[[wikilinks]]` resolve inside the app; a link to a note that doesn't
exist renders as plain text, because in Obsidian that's a deliberate act, not an error.

**Synthesis** — the weekly write-up, set for reading, with every claim linked to the record
it came from.

**Search** (`⌘K`) spans all of it — and deliberately reaches records the default views hide:
archived library items, completed and dropped todos. Search is recall; nothing is hidden
from it.

---

## Two rules that shaped everything

**Streaks may count up but may never be shown as broken.** No "0 days", no red, no guilt on
return. Missed days render as neutral empty space and the longest run is banked permanently.

This isn't a style preference. The real journal data behind this app runs 39% adherence over
211 days, decaying from 100% in January to 14% in July, with a 24-day maximum gap. Someone
returning after three weeks away is the most important user to design for, and a broken
streak is what makes them close the tab for good. `StreakInfo` carries no field from which a
broken state could be derived.

**Red means destructive, and nothing else.** Not overdue, not over budget, not over
capacity — those are gold. Tailwind's default palette is stripped, so `bg-red-500` does not
exist; red can only come from `--danger`, which appears in exactly two components.

---

## Architecture

```
Telegram ──┐
           ├──►  Inbox/*.md  ──►  /sort-inbox  ──►  the vault
Quick capture ┘                                       │
                                                      ├── data/*.json     trackers
                                                      ├── Journal/        reflection
                                                      ├── Library/        read later
                                                      ├── Brain Dump/     threads
                                                      └── Synthesis/      weekly
                                                            ▲
                                    ┌───────────────────────┼───────────────────┐
                                    │                       │                   │
                              Electron app             Obsidian            Claude Code
```

**Files are the truth.** No database, no server, no HTTP layer. The renderer never touches
`fs` — every read and write crosses an IPC boundary with a typed allowlist, which
is what makes the main-process mutation lock mean anything.

**Four processes write to this vault** — the app, the bot, the sort scripts, and Obsidian.
Every JSON tracker is read-modify-written whole, so an unlocked write loses records. The app
and bot both implement a cross-process advisory lock (`data/.desvu.lock`, `O_CREAT|O_EXCL`,
stale recovery only when the pid is dead *and* the host matches). The bot's implementation
was written independently from the spec in `docs/lockfile-protocol.md`, and contention is
tested by spawning a real child process running it.

**Tabular and countable → JSON. Prose and connectable → markdown.** Todos and purchases are
rows. Articles and thoughts are notes with frontmatter, so they appear in the Obsidian graph
and can be linked to.

### Stack

Electron · React 18 · TypeScript · Vite (`electron-vite`) · Tailwind 4 · zustand · Recharts.
The bot is plain ESM Node with grammY and no other dependency.

### Layout

```
app/
  src/main/repos/     15 file-backed repositories + the IPC router
  src/preload/        window.desvu, built mechanically from the channel allowlist
  src/renderer/       React — 7 surfaces, 14 primitives, per-domain components
  src/shared/         types, IPC contract, vault resolution  (the coordination points)
  scripts/            journal migration, dev seeders, font fetcher
  test/               27 Vitest files
bot/
  src/                receiver, whitelist, inbox format, media, vault lock
  launchd/            always-on job (written, not installed)
docs/                 lockfile protocol
PROGRESS.md           orientation for anyone picking this up
```

---

## Design

Warm paper-and-ink. Light `#FDFAF3` / dark `#0B0A08`, a single antique-gold accent, Cormorant
for prose and DM Sans for tools and numbers — both self-hosted as variable fonts, so fonts require no external network requests. Connecting Google Calendar enables
explicit OAuth and Calendar API requests from the main process.

Categories resolve by **shape**, not colour — recruiting is a square, school a circle,
personal a diamond. The three hues sit within 1.03:1 of each other by design so they never
outrank the accent, which means colour alone was never a usable encoding.

Estimated values are set in italic Cormorant, so the typography itself is the disclaimer:
you can tell a guess from a measurement at a glance.

---

## Setup

**Prerequisites:** Node 20+, an Obsidian vault, and a Telegram bot token from
[@BotFather](https://t.me/BotFather).

```bash
npm install --prefix app && npm install --prefix bot
```

Credentials live outside the repo and outside the vault, at `~/.config/desvu/bot.env`
(mode `600`):

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_ALLOWED_USER_ID=...
```

Run the app, and the bot:

```bash
npm run dev --prefix app
```

```bash
npm start --prefix bot
```

### Always-on capture

Capture is only useful if it is always listening, so the bot ships as a macOS LaunchAgent —
it starts at login, restarts if it crashes, and logs to `~/Library/Logs/desvu-bot.log` with
the token redacted on every line. The plist contains **no credentials**; the bot reads
`~/.config/desvu/bot.env` itself.

```bash
cp bot/launchd/com.desvu.bot.plist ~/Library/LaunchAgents/
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.desvu.bot.plist
```

```bash
launchctl kickstart -p gui/$(id -u)/com.desvu.bot
```

Check it, restart it after changing credentials, or remove it:

```bash
launchctl print gui/$(id -u)/com.desvu.bot | grep -E "state|pid"
```

```bash
launchctl kickstart -k gui/$(id -u)/com.desvu.bot
```

```bash
launchctl bootout gui/$(id -u)/com.desvu.bot
```

Two things about the plist that are easy to get wrong:

- **It injects `/opt/homebrew/bin` into `PATH`.** launchd hands out a bare `PATH`, which
  hides the Homebrew tools the bot probes for at startup. Without this, OCR and voice
  transcription silently degrade to `[photo, no-ocr]` and `[voice, untranscribed]` even
  though `tesseract` and `whisper-cli` are installed — the bot keeps working and the
  captures keep landing, so nothing looks broken.
- **It runs Homebrew's node, not nvm's.** nvm paths are pinned to a version directory and
  break on the next upgrade; the Homebrew symlink survives.

Startup logs what it can actually do, so a degraded capability is visible immediately:

```
capabilities · transcription: whisper.cpp · ocr: tesseract
connected as @yourbot (id …) — long polling
```

Only one instance may poll at a time — a second one fights the first over `getUpdates`.
Stop any foreground `npm start` before bootstrapping the agent.

The vault is found via `DESVU_VAULT`, then `~/Documents/Dès vu`, then the iCloud Obsidian
container. Discovery requires a marker file (`PRD.md` or `data/SCHEMAS.md`) so a stray
directory can't shadow the real corpus.

**Always point `DESVU_VAULT` at a throwaway directory when developing.** The real vault holds
months of personal journal entries and has no remote.

### Tests

```bash
npm test --prefix app && npm test --prefix bot
```

507 in the app, 82 in the bot. They cover the things that would be quiet and expensive to get
wrong: lock contention across real processes, streaks that can never render broken, recurrence
that doesn't backlog after an absence, search reaching archived and completed records, and
byte-identical thread output between the app and the sort skill.

---

## Notes

- **Journal prose never leaves the machine.** `settings.synthesis.journal_access` governs what
  agents can read, enforced by a projection in the repository rather than a prompt
  instruction — a model can't be argued past it.
- **The in-app sort button spawns the Claude CLI**, passing an explicit `--allowedTools`
  allowlist. `--dangerously-skip-permissions` is deliberately unused: a convenience button
  isn't worth giving a background process unrestricted tool access. A run takes 40–115s and
  bills real tokens, so batching captures is meaningfully cheaper than sorting each time.
- **Filed counts are derived from the Inbox**, before and after — not parsed from the agent's
  summary. A model that says it filed five things can't make that true.
- **The Today surface is complete and tested but has not been driven in a running app.** Every
  other surface has been verified live in both themes.
- Google Calendar now syncs through the multi-account desktop integration; see
  [setup and storage details](docs/calendar.md). Gmail integration is not configured.
