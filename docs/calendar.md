# Calendar and task scheduling

Calendar combines local tasks with read-only Google events. It has day, Monday-first
week, and month views. Times use the Mac's current timezone.

## Schedule tasks

Click a time or **Schedule task**, then create a task or choose an existing one. Set
its start and end date/time and save. Drag a task to another slot to move it while
keeping its duration. In month view, dragging to another day keeps its local time.
Click a task to edit it; **Remove time** keeps it on its due date as an untimed task.
Scheduled blocks reserve time in Today and are excluded from its automatic gap filling.

Tasks stay in the local vault. This integration does not create or edit Google events,
send invitations, or add notifications. Recurring task instances retain the template's
local start time; the existing recurrence engine materializes the current/next instance,
so future months do not display an unlimited series of projected occurrences.

## Connect Google accounts

The app supports multiple accounts, with independent calendar selections and sync status.
Use **Calendar → Google accounts**. One Google Desktop OAuth client can serve all of
your accounts; each account grants its own access.

1. In Google Cloud, select/create a project and enable the **Google Calendar API**.
2. Configure Google Auth Platform's branding and an **External** audience so personal
   and Workspace accounts can sign in. In Testing mode, add each account as a test user.
3. Create an OAuth client of type **Desktop app** and download its credentials JSON.
4. In Dès vu, choose **Import credentials JSON**. Then connect each account in turn
   using the Google browser sign-in and consent screen.
5. The primary calendar is selected initially. Use the checkboxes to include shared,
   secondary, or subscribed calendars from that account.

A Workspace administrator may restrict access. The app reports Google's error and keeps
previously imported events when an account cannot refresh. The app does not bypass these
restrictions. Google may require reconnection for a revoked or expired authorization.

Selected calendars refresh every five minutes while the app is running, when the visible
date range changes, and when you click **Sync**. Outside Calendar, the default range is
30 days back through 90 days ahead. All-day events use Google's exclusive end date.
Cancelled events and invitations declined by the connected user are excluded; events
marked free remain visible but do not reserve time in Today.

## Local storage

`data/todos.json` adds optional `scheduled_start` and `scheduled_end` fields. Both are
null/absent for an untimed task, or both are ISO timestamps with a timezone offset.
The end must follow the start. `due` is the local date of the scheduled start. Updating
only `due` moves an existing block to that date; clearing `due` removes the block.
Existing task files are compatible without a migration.

`data/calendar.json` is a cache, containing `events` and `last_refresh`. Imported event IDs
are namespaced by account and calendar. Events include `account_email`, `calendar_id`,
`calendar_name`, `color`, and `busy`. Each successful account sync replaces only its
events in the requested date range. A failed account keeps its previous cache.

Google configuration lives outside the vault and repository:
`~/Library/Application Support/Dès vu/google-calendar/`. The directory uses mode 700 and
JSON files mode 600. `client.json` holds the Desktop client configuration; `accounts.json`
holds selected calendars and refresh tokens encrypted using Electron `safeStorage`
and macOS Keychain. Access tokens are transient. Tokens are never returned to the UI.
Disconnect removes the locally saved account/token and cached events. Access can also
be revoked from the Google account's third-party access settings.

OAuth uses a random state, PKCE S256, a short-lived localhost callback server, and these
scopes: `userinfo.email`, `calendar.calendarlist.readonly`, `calendar.events.readonly`.
It does not request Gmail, calendar write, or invitation permissions.

Google references:
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
