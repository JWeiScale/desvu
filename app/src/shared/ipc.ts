import type { InstinctStatus } from './instinct'
import type {
  BrainDumpThread,
  CalendarEvent,
  CalendarRefreshResult,
  CalendarStatus,
  GoogleCalendar,
  CategorySpend,
  CreateTodoInput,
  CreateGoalInput,
  UpdateGoalInput,
  Goal,
  CorrectionFactor,
  DateString,
  DayLoad,
  JournalEntry,
  LibraryItem,
  LibraryStatus,
  Meal,
  Purchase,
  SearchHit,
  SortInboxResult,
  SynthesisNote,
  Settings,
  StreakInfo,
  Todo,
  UpdateTodoInput,
  UpsertJournalInput,
  Workout,
} from './types'

/**
 * The renderer's entire view of the filesystem. There is no HTTP layer and no direct
 * `fs` access from the renderer — every read and write crosses this boundary, which is
 * what keeps the mutation lock in the main process meaningful.
 *
 * Channel names are `<domain>:<method>` and are derived mechanically from this shape,
 * so adding a method means adding it here, in the main-process router, and in the
 * preload allowlist. All three are checked by `test/ipc-contract.test.ts`.
 */
export interface DesvuApi {
  instinct: {
    status(): Promise<InstinctStatus>
    check(): Promise<InstinctStatus>
    configure(contact: string, enabled: boolean): Promise<InstinctStatus>
  }

  todos: {
    /** Excludes recurrence templates — they are not tasks. See `listTemplates`. */
    list(): Promise<Todo[]>
    /**
     * The recurrence templates themselves. Without this nothing can hand the UI a
     * template id, which would leave recurring tasks uneditable and undeletable.
     */
    listTemplates(): Promise<Todo[]>
    /** Open + doing todos relevant to `date`, recurrence instances materialized. */
    forDate(date: DateString): Promise<Todo[]>
    create(input: CreateTodoInput): Promise<Todo>
    update(id: string, updates: UpdateTodoInput): Promise<Todo>
    /** Records `actual_minutes` and spawns the next instance if this was recurring. */
    complete(id: string, actualMinutes: number | null): Promise<Todo>
    reopen(id: string): Promise<Todo>
    remove(id: string): Promise<void>
    /** The "is today realistic?" numbers, calendar included. */
    dayLoad(date: DateString): Promise<DayLoad>
    correctionFactors(): Promise<CorrectionFactor[]>
  }

  goals: {
    list(): Promise<Goal[]>
    create(input: CreateGoalInput): Promise<Goal>
    update(id: string, updates: UpdateGoalInput): Promise<Goal>
    remove(id: string): Promise<void>
  }

  journal: {
    list(): Promise<JournalEntry[]>
    byDate(date: DateString): Promise<JournalEntry | null>
    upsert(input: UpsertJournalInput): Promise<JournalEntry>
    remove(id: string): Promise<void>
    /** Never exposes a "broken" state — see PRD J6. */
    streak(): Promise<StreakInfo>
  }

  finance: {
    list(): Promise<Purchase[]>
    create(input: Omit<Purchase, 'id' | 'created_at'>): Promise<Purchase>
    update(id: string, updates: Partial<Omit<Purchase, 'id' | 'created_at'>>): Promise<Purchase>
    remove(id: string): Promise<void>
    /** Spent vs limit per category, month to date. */
    monthSummary(month: string): Promise<CategorySpend[]>
  }

  meals: {
    list(): Promise<Meal[]>
    forDate(date: DateString): Promise<Meal[]>
    create(input: Omit<Meal, 'id' | 'created_at'>): Promise<Meal>
    update(id: string, updates: Partial<Omit<Meal, 'id' | 'created_at'>>): Promise<Meal>
    remove(id: string): Promise<void>
  }

  workouts: {
    list(): Promise<Workout[]>
    forDate(date: DateString): Promise<Workout[]>
    create(input: Omit<Workout, 'id' | 'created_at'>): Promise<Workout>
    update(id: string, updates: Partial<Omit<Workout, 'id' | 'created_at'>>): Promise<Workout>
    remove(id: string): Promise<void>
  }

  library: {
    /** Archived items are excluded unless `includeArchived`. */
    list(options?: { includeArchived?: boolean }): Promise<LibraryItem[]>
    create(input: {
      title: string
      url?: string | null
      type?: LibraryItem['type']
      tags?: string[]
      estimated_minutes?: number | null
      body?: string
    }): Promise<LibraryItem>
    setStatus(path: string, status: LibraryStatus): Promise<LibraryItem>
    setArchived(path: string, archived: boolean): Promise<LibraryItem>
    /** Items whose `estimated_minutes` fits the window, best fit first. */
    fitting(freeMinutes: number): Promise<LibraryItem[]>
    /** Archives unread items older than `settings.library.auto_archive_days`. */
    runAutoArchive(): Promise<{ archived: number }>
  }

  brainDump: {
    listThreads(): Promise<BrainDumpThread[]>
    readThread(path: string): Promise<BrainDumpThread | null>
    /** Appends a `## YYYY-MM-DD` block rather than creating a new file. */
    appendToThread(path: string, text: string): Promise<BrainDumpThread>
    createThread(topic: string, title: string, text: string): Promise<BrainDumpThread>
    listTopics(): Promise<string[]>
  }

  synthesis: {
    /** Newest week first. Bodies included — the folder is one small file per week. */
    list(): Promise<SynthesisNote[]>
    /** `week` is an ISO week key, e.g. `2026-W31`. */
    read(week: string): Promise<SynthesisNote | null>
  }

  inbox: {
    /** Raw unsorted lines, newest first. */
    read(): Promise<{ file: string; line: string; at: Timestampish }[]>
    count(): Promise<number>
    /**
     * Run `/sort-inbox` by spawning the Claude CLI in the vault.
     *
     * The bot is a dumb receiver by design, so this is where raw captures become records.
     * It is a separate process writing the same trackers as the app, which is exactly what
     * the cross-process lock exists for.
     */
    sort(options?: { dryRun?: boolean }): Promise<SortInboxResult>
    cancelSort(): Promise<void>
    /** False when the Claude CLI is not installed — the control hides rather than failing. */
    sortAvailable(): Promise<boolean>
  }

  calendar: {
    forDate(date: DateString): Promise<CalendarEvent[]>
    forRange(from: DateString, to: DateString): Promise<CalendarEvent[]>
    configure(): Promise<{ configured: boolean }>
    openSetup(): Promise<void>
    connect(email?: string): Promise<CalendarStatus>
    cancelConnect(): Promise<void>
    disconnect(email: string): Promise<void>
    calendars(email: string): Promise<GoogleCalendar[]>
    selectCalendars(email: string, ids: string[]): Promise<void>
    /** Epoch ms of the last successful refresh, or null if never. */
    lastRefresh(): Promise<number | null>
    /** Whether a Google refresh token is stored. False means "never connected". */
    status(): Promise<CalendarStatus>
    /** Pull from Google into `data/calendar.json`. Resolves with what changed. */
    refresh(range?: { from: DateString; to: DateString }): Promise<CalendarRefreshResult>
  }

  settings: {
    get(): Promise<Settings>
    update(patch: DeepPartial<Settings>): Promise<Settings>
  }

  search: {
    /** Reaches archived and completed records — nothing is hidden from recall. */
    query(q: string): Promise<SearchHit[]>
  }

  system: {
    vaultPath(): Promise<string>
    /** Opens a vault-relative path in Obsidian. */
    openInObsidian(relativePath: string): Promise<void>
    /** Appends a raw line to the Inbox, same shape the Telegram bot writes. */
    quickCapture(text: string): Promise<void>
  }
}

type Timestampish = number
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/** Every channel the preload is allowed to invoke. Keep sorted; the test asserts parity. */
export const IPC_CHANNELS = [
  'todos:list',
  'todos:listTemplates',
  'todos:forDate',
  'todos:create',
  'todos:update',
  'todos:complete',
  'todos:reopen',
  'todos:remove',
  'todos:dayLoad',
  'todos:correctionFactors',

  'instinct:status',
  'instinct:check',
  'instinct:configure',

  'goals:list',
  'goals:create',
  'goals:update',
  'goals:remove',

  'journal:list',
  'journal:byDate',
  'journal:upsert',
  'journal:remove',
  'journal:streak',

  'finance:list',
  'finance:create',
  'finance:update',
  'finance:remove',
  'finance:monthSummary',

  'meals:list',
  'meals:forDate',
  'meals:create',
  'meals:update',
  'meals:remove',

  'workouts:list',
  'workouts:forDate',
  'workouts:create',
  'workouts:update',
  'workouts:remove',

  'library:list',
  'library:create',
  'library:setStatus',
  'library:setArchived',
  'library:fitting',
  'library:runAutoArchive',

  'brainDump:listThreads',
  'brainDump:readThread',
  'brainDump:appendToThread',
  'brainDump:createThread',
  'brainDump:listTopics',

  'synthesis:list',
  'synthesis:read',

  'inbox:read',
  'inbox:count',
  'inbox:sort',
  'inbox:cancelSort',
  'inbox:sortAvailable',

  'calendar:forDate',
  'calendar:forRange',
  'calendar:configure',
  'calendar:openSetup',
  'calendar:connect',
  'calendar:cancelConnect',
  'calendar:disconnect',
  'calendar:calendars',
  'calendar:selectCalendars',
  'calendar:lastRefresh',
  'calendar:status',
  'calendar:refresh',

  'settings:get',
  'settings:update',

  'search:query',

  'system:vaultPath',
  'system:openInObsidian',
  'system:quickCapture',
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

/** Main-process push events the renderer subscribes to. */
export const IPC_EVENTS = {
  /** A vault file changed on disk — from Obsidian, the bot, or a refresh script. */
  vaultChanged: 'event:vault-changed',
  /**
   * The global accelerator fired (PRD C8). Main owns the shortcut because it must work
   * when the window is unfocused, so opening the capture field has to be pushed.
   */
  quickCapture: 'event:quick-capture',
  /** Streamed while `/sort-inbox` runs, so a two-minute wait does not look like a hang. */
  sortProgress: 'event:sort-progress',
} as const
