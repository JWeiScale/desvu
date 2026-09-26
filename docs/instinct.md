# Instinct in iMessage

Dès vu can import new tasks, goals, and Inbox notes from one private Instinct
conversation in Messages on the same Mac. It does not expose the vault to Instinct,
send messages, or read attachments. It cannot edit or delete existing records.

## Setup and use

1. Build the desktop app and run `sh app/scripts/fetch-imsg.sh` on macOS 14 or later.
   When packaging, copy `app/resources/imsg` alongside `out` in the app's resource
   directory. The script pins imsg v0.15.9 and verifies its release archive SHA256.
   The optional private-framework bridge is deliberately excluded.
2. Open **Instinct connection** in the Capture card. Enter the exact international
   phone number or email shown in your private Instinct conversation.
3. Enable **Full Disk Access** for Dès vu in macOS System Settings → Privacy &
   Security, then quit and reopen Dès vu. This macOS permission covers protected
   data beyond Messages; the connector itself selects only the configured chat.
4. Choose **Connect Instinct**. The first successful connection establishes a
   baseline at the current end of the conversation, skipping old messages.
5. Open **Setup instructions**, select and copy the text, and send it to Instinct.
6. Send an explicit request, such as:
   `Desvu: add a goal to finish my ML Systems notes by October 2, 2026.`
7. Check **Recent activity** in Dès vu to confirm the import. Instinct's response
   alone does not prove that it saved on the Mac.

Keep Dès vu running. It checks every five seconds and catches up after reopening.
Pausing stops reads; resuming the same connection catches up from its saved cursor.
Tasks with start and end timestamps also appear on Calendar. Notes land in Inbox.
One request creates one item; send separate requests for multiple items.

## Protocol and data handling

Replies must be an entire plain-text message starting `DESVU ` followed by one
strict JSON object. `request` repeats an outstanding outgoing `Desvu:` message
exactly. Replies must arrive within 24 hours of the request (catchup can happen
later). Example:

```json
{"request":"Desvu: add a goal to finish my notes by October 2, 2026.","kind":"goal","title":"Finish my notes","deadline":"2026-10-02"}
```

Task fields: `title`, optional `due`, `category`, `notes`, `scheduled_start`, and
`scheduled_end`. Goal fields: `title`, `deadline`, optional `notes`. Note fields:
`text`. Every object also requires `kind` and `request`. Unknown fields, invalid
dates, group messages, wrong senders, unsolicited responses, and unmatched
requests are rejected. No raw commands, URLs to fetch, or paths are executed.

The main process makes a targeted read-only SQLite lookup to resolve the chat,
then uses only imsg's `messages.after` RPC over local child-process stdio. No
network server or launch agent is installed. The helper's MIT license is included
in `app/resources/imsg/LICENSE`.

Connection settings, the cursor, up to 100 pending explicit requests, and the last
30 activity records stay in `instinct/connection.json` under Electron's user-data
directory, outside the vault and Git. Imported records reside in the existing
vault. Stable request-derived IDs in atomic repository writes prevent duplicate
records if the app crashes between creating an item and saving the cursor. Inbox
notes carry a hidden import marker. Preserve these IDs/markers if editing the
files externally. A replaced Messages database pauses importing and requires a
new connection baseline.

The integration depends on macOS's local Messages database and the pinned helper;
a future macOS schema change may require an update. It requires Messages to sync
the Instinct conversation onto the Mac. Instinct must remember the reply protocol;
if it replies in ordinary prose, ask it to follow the setup instructions again.
