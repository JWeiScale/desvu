# Goals

Open **Goals** in the sidebar and choose **New goal**. Give it a title and a deadline;
notes are optional. Goals are ordered by deadline and show days remaining, due today,
or days past the deadline. Dates use local calendar days, with the deadline lasting
through the end of the selected day.

Use **Edit** to change the title, date, or notes. **Mark complete** moves the goal to
Completed; **Reopen** returns it to Active. The filters show Active, Completed, or All.
Deletion requires a second confirmation and removes the goal and its notes permanently.
Global search includes active and completed goals. Choose the Completed or All filter
to view completed goals after navigating from search.

Goals are separate from scheduled tasks. They do not add calendar events or reminders.

## Data schema

`data/goals.json` is an array of these records:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable unique identifier |
| `title` | string | Required, nonempty goal title |
| `deadline` | string | Required real local date, `YYYY-MM-DD` |
| `notes` | string | Optional notes, stored as an empty string when omitted |
| `status` | `active` or `completed` | Current state |
| `created_at` | number | Creation time in epoch milliseconds |
| `updated_at` | number | Last edit time in epoch milliseconds |
| `completed_at` | number or null | Completion time; null while active |

The file is created on the first goal save. Existing vaults need no migration. Writes
use the same atomic replacement and cross-process vault lock as the other trackers.
Invalid files are reported rather than overwritten. Back up the entire vault to retain
goals alongside tasks and notes.
