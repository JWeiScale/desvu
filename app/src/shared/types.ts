/**
 * Canonical record shapes. These mirror `data/SCHEMAS.md` in the vault — that document
 * is the spec, this file is the implementation of it. Change them together.
 */

export const CATEGORIES = [
  'personal',
  'school',
  'recruiting',
  'ml-systems',
  'reinforcement-learning',
] as const
export type Category = (typeof CATEGORIES)[number]

export type Source = 'app' | 'telegram' | 'import'

/** `YYYY-MM-DD`, local. Anything a human thinks of as "a day". */
export type DateString = string
/** Epoch milliseconds. */
export type Timestamp = number

// ---------------------------------------------------------------------------
// todos
// ---------------------------------------------------------------------------

export type TodoStatus = 'open' | 'doing' | 'done' | 'dropped'
/** 0 = drop everything, 1 = high, 2 = normal, 3 = someday. */
export type Priority = 0 | 1 | 2 | 3

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type Recurrence =
  | { type: 'daily'; interval: number }
  | { type: 'weekly'; interval: number; days: Weekday[] }
  | { type: 'monthly'; interval: number; day_of_month: number }

export interface Todo {
  id: string
  text: string
  category: Category
  priority: Priority
  estimate_minutes: number | null
  actual_minutes: number | null
  due: DateString | null
  /** Fixed calendar block, stored as ISO instants. Missing/null means not scheduled. */
  scheduled_start?: string | null
  scheduled_end?: string | null
  status: TodoStatus
  /** Non-null makes this a template. Templates never appear in a list. */
  recurrence: Recurrence | null
  /** Set on spawned instances, pointing at the template. */
  recurrence_parent: string | null
  tags: string[]
  notes: string
  source: Source
  created_at: Timestamp
  updated_at: Timestamp
  completed_at: Timestamp | null
}

export type CreateTodoInput = Partial<
  Omit<Todo, 'id' | 'text' | 'created_at' | 'updated_at' | 'completed_at'>
> & { text: string }

export type UpdateTodoInput = Partial<
  Omit<Todo, 'id' | 'created_at' | 'updated_at'>
>

// ---------------------------------------------------------------------------
// goals
// ---------------------------------------------------------------------------

export type GoalStatus = 'active' | 'completed'

export interface Goal {
  id: string
  title: string
  /** A local calendar date; the goal is due through the end of this day. */
  deadline: DateString
  notes: string
  status: GoalStatus
  created_at: Timestamp
  updated_at: Timestamp
  completed_at: Timestamp | null
}

export type CreateGoalInput = Pick<Goal, 'title' | 'deadline'> & Partial<Pick<Goal, 'notes'>>
export type UpdateGoalInput = Partial<Pick<Goal, 'title' | 'deadline' | 'notes' | 'status'>>

// ---------------------------------------------------------------------------
// journal
// ---------------------------------------------------------------------------

/** 1–7. Widened from the original 1–5 so the imported 6s and 7s survive losslessly. */
export type Rating = 1 | 2 | 3 | 4 | 5 | 6 | 7
export const RATING_MIN = 1
export const RATING_MAX = 7

export interface JournalEntry {
  id: string
  entry_date: DateString
  /** The only required field. A rating alone is a complete entry. */
  rating: Rating
  gratitude_text?: string
  learned?: string
  mood_word?: string
  mood_context?: string
  created_at: Timestamp
  updated_at: Timestamp
}

export type UpsertJournalInput = { entry_date: DateString; rating: Rating } & Partial<
  Pick<JournalEntry, 'gratitude_text' | 'learned' | 'mood_word' | 'mood_context'>
>

/** What `synthesis.journal_access: "metadata"` projects down to. */
export type JournalMetadata = Pick<JournalEntry, 'entry_date' | 'rating' | 'mood_word'>

/**
 * Streaks may be shown counting up but MUST NEVER be shown as broken (PRD J6).
 * There is deliberately no `broken` field and no way to derive one from this shape.
 */
export interface StreakInfo {
  /** Consecutive days ending today or yesterday. 0 means "not currently running". */
  current: number
  /** Banked permanently. Never decreases. */
  longest: number
  /** Total days with any entry. */
  total: number
}

// ---------------------------------------------------------------------------
// finance
// ---------------------------------------------------------------------------

export interface Purchase {
  id: string
  date: DateString
  /** Positive dollars. Income and refunds are negative. */
  amount: number
  /** Free string. A category absent from settings logs fine and shows as uncategorised. */
  category: string
  description: string
  source: Source
  created_at: Timestamp
}

export interface FinanceFile {
  purchases: Purchase[]
}

export interface BudgetCategory {
  name: string
  /** Monthly limit in dollars. Null = tracked but uncapped. */
  limit: number | null
}

/**
 * The bucket a purchase falls into when its category is blank. Lives here rather than in
 * the repository because both the main process and the renderer need to recognise it, and
 * two copies of a magic string is a drift waiting to happen.
 */
export const UNCATEGORISED = 'uncategorised'

export interface CategorySpend {
  category: string
  spent: number
  /** Null means no cap — see `configured` to tell "uncapped" from "not a budget line". */
  limit: number | null
  /**
   * Whether this category exists in `settings.finance.categories`.
   *
   * Without it, `limit: null` is ambiguous between "the user defined this category and
   * chose not to cap it" and "money landed in a category nobody ever defined". Those
   * render differently, and resolving it in the UI means re-reading settings just to
   * interpret a summary that already had the answer.
   */
  configured: boolean
  /** Null when there is no limit. */
  fraction: number | null
}

// ---------------------------------------------------------------------------
// meals + workouts
// ---------------------------------------------------------------------------

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Meal {
  id: string
  date: DateString
  meal: MealSlot
  description: string
  /** Nullable on purpose — requiring numbers is how food logs die. */
  calories: number | null
  protein_g: number | null
  /** True when the numbers were guessed by the sort skill rather than measured. */
  estimated: boolean
  source: Source
  created_at: Timestamp
}

export type WorkoutType = 'lift' | 'run' | 'climb' | 'sport' | 'other'

export interface Workout {
  id: string
  date: DateString
  type: WorkoutType
  description: string
  duration_minutes: number | null
  source: Source
  created_at: Timestamp
}

// ---------------------------------------------------------------------------
// library (markdown-backed)
// ---------------------------------------------------------------------------

export type LibraryType = 'article' | 'video' | 'paper' | 'other'
export type LibraryStatus = 'unread' | 'reading' | 'done'

export interface LibraryItem {
  /** Vault-relative path, e.g. `Library/2026-08-01-ddia-ch5.md`. Acts as the id. */
  path: string
  title: string
  url: string | null
  type: LibraryType
  status: LibraryStatus
  source: string | null
  tags: string[]
  /** Powers "what fits in the 40 minutes you have free". */
  estimated_minutes: number | null
  saved: DateString
  /** Auto-set after `library.auto_archive_days`. Archived items stay in the vault. */
  archived: boolean
  /** Body below the frontmatter. */
  body: string
}

// ---------------------------------------------------------------------------
// brain dump (markdown-backed)
// ---------------------------------------------------------------------------

export interface BrainDumpThread {
  /** Vault-relative path, e.g. `Brain Dump/Recruiting/systems-design.md`. */
  path: string
  topic: string
  title: string
  created: DateString
  updated: DateString
  tags: string[]
  body: string
}

// ---------------------------------------------------------------------------
// synthesis (markdown-backed, written by the synthesis agent)
// ---------------------------------------------------------------------------

export interface SynthesisNote {
  /** Vault-relative, e.g. `Synthesis/2026-W31.md`. */
  path: string
  /** ISO week key, `YYYY-Www`. */
  week: string
  body: string
}

// ---------------------------------------------------------------------------
// calendar (written by a refresh script, read-only to the app)
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string
  title: string
  /** ISO 8601 with offset. */
  start: string
  end: string
  all_day: boolean
  location?: string
  account_email?: string
  calendar_id?: string
  calendar_name?: string
  color?: string
  /** Free/transparent events display without occupying planning time. */
  busy?: boolean
}

export interface GoogleCalendar {
  id: string
  name: string
  color: string
  primary: boolean
  selected: boolean
}

export interface GoogleAccount {
  email: string
  connected: boolean
  calendars: GoogleCalendar[]
  last_sync: number | null
  error?: string
}

/** Why the calendar is or is not usable, in the terms the UI needs to explain it. */
export interface CalendarStatus {
  /** A refresh token is stored. */
  connected: boolean
  /** OAuth client credentials exist — without these, connecting is not even possible. */
  configured: boolean
  last_refresh: number | null
  accounts?: GoogleAccount[]
}

export interface CalendarRefreshResult {
  ok: boolean
  events: number
  /** Present when the refresh failed, written for a human rather than a log. */
  error?: string
  warnings?: string[]
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export interface Settings {
  finance: {
    categories: BudgetCategory[]
    currency: string
    month_starts_on: number
  }
  nutrition: {
    calorie_target: number | null
    protein_target_g: number | null
    show_targets: boolean
  }
  todos: {
    default_priority: Priority
    default_estimate_minutes: number
  }
  library: {
    auto_archive_days: number
  }
  synthesis: {
    /** Enforced by a repository projection, not by prompt instruction. */
    journal_access: 'full' | 'metadata'
  }
}

export const DEFAULT_SETTINGS: Settings = {
  finance: { categories: [], currency: 'USD', month_starts_on: 1 },
  nutrition: { calorie_target: null, protein_target_g: null, show_targets: false },
  todos: { default_priority: 2, default_estimate_minutes: 30 },
  library: { auto_archive_days: 30 },
  synthesis: { journal_access: 'full' },
}

// ---------------------------------------------------------------------------
// derived views
// ---------------------------------------------------------------------------

/** Per-category multiplier derived from estimate-vs-actual, once enough data exists. */
export interface CorrectionFactor {
  category: Category
  factor: number
  sample_size: number
  /** False until `sample_size` crosses the threshold; UI must not show an unconfident factor. */
  confident: boolean
}

/** The "is today realistic?" numbers. */
export interface DayLoad {
  date: DateString
  committed_minutes: number
  free_minutes: number
  due_minutes: number
  /** `due_minutes` scaled by the per-category correction factors, when confident. */
  corrected_due_minutes: number | null
  /** Todos that do not fit in the remaining free time, in the order they were dropped. */
  overflow: Todo[]
}

/**
 * The outcome of an in-app `/sort-inbox` run.
 *
 * `filed` and `needsYou` are derived from the Inbox itself — unsorted lines counted before
 * and after — not parsed out of the agent's summary. A model that says it filed five things
 * cannot make that true, and this is a number the user will act on.
 */
export interface SortInboxResult {
  ok: boolean
  cancelled: boolean
  /** Lines that left the unsorted state. */
  filed: number
  /** Lines still unsorted. Headless cannot ask questions, so ambiguous ones stay put. */
  needsYou: number
  /** The agent's own closing summary, shown as prose. */
  summary: string
  duration_ms: number
  /**
   * Set when the run finished but could not do everything it intended — a denied tool, a
   * malformed tracker. Must reach the UI: a partial run that renders as success is a lie.
   */
  degraded?: string
}

/** Streamed while a sort runs, so a two-minute wait does not look like a hang. */
export interface SortInboxProgress {
  phase: 'starting' | 'scanning' | 'routing' | 'writing' | 'done'
  /** A short human-readable line, e.g. "reading Inbox/2026-08-01.md". */
  note: string
}

export interface SearchHit {
  kind: 'todo' | 'goal' | 'journal' | 'library' | 'brain-dump' | 'meal' | 'workout' | 'synthesis'
  id: string
  title: string
  snippet: string
  date: DateString | null
  /** Vault-relative path for markdown-backed hits, so Obsidian can be opened at it. */
  path?: string
  /**
   * The record's own status, when it has one — `archived`, `done`, `dropped`, `unread`.
   *
   * Search deliberately reaches records the default views hide (PRD S1–S3), so without
   * this the user gets a result they cannot find anywhere else and no explanation of why.
   * Absent for records with no meaningful state, like a journal entry.
   */
  state?: string
}
