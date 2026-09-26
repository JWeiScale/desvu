import { localDay, overlapsDay, scheduledEvent, scheduledWindow, scheduleOnDay, validateSchedule } from '@shared/scheduling'
import { CATEGORIES } from '@shared/types'
import type {
  Category,
  CorrectionFactor,
  CreateTodoInput,
  DateString,
  DayLoad,
  Priority,
  Recurrence,
  Source,
  Todo,
  TodoStatus,
  UpdateTodoInput,
} from '@shared/types'
import { dataPath } from '@shared/vault'
import {
  minutesSinceMidnight,
  toDateString,
  todayString,
} from '../lib/dates'
import { NotFoundError, ValidationError } from '../lib/errors'
import { newId } from '../lib/ids'
import { createJsonStore, expectArray } from '../lib/json-store'
import { latestOccurrenceOnOrBefore, nextOccurrenceAfter } from '../lib/recurrence'
import {
  Issues,
  checkCategory,
  checkDate,
  checkNonEmptyText,
  checkNonNegativeInt,
  checkPriority,
  checkRecurrence,
  checkSource,
  checkStatus,
  checkTags,
} from '../lib/validate'
import { calendarRepository } from './calendarRepository'
import { settingsRepository } from './settingsRepository'

/**
 * ~25 completions in a category before its correction factor is worth showing (PRD T11).
 * Below that a couple of unusual tasks swing the multiplier hard, and a number the user
 * learns to distrust is worse than no number at all.
 */
export const CORRECTION_CONFIDENCE_THRESHOLD = 25

/** The window a day's free time is measured in: 08:00 to midnight, local. */
export const DAY_START_MINUTE = 8 * 60
export const DAY_END_MINUTE = 24 * 60

const store = createJsonStore<Todo[]>(
  () => dataPath('todos.json'),
  () => [],
  (parsed, filePath) => expectArray<Todo>(parsed, filePath)
)

// --- normalisation -------------------------------------------------------------------

/**
 * Todos are also written by `/sort-inbox` and by hand in Obsidian, so a record on disk
 * may be missing fields the app assumes. Filling them in on read keeps a half-written
 * record usable instead of crashing the whole list; writes are validated strictly.
 */
function normalize(raw: Partial<Todo> & { id?: string }): Todo {
  const created = typeof raw.created_at === 'number' ? raw.created_at : Date.now()
  const category = (CATEGORIES as readonly string[]).includes(raw.category as string)
    ? (raw.category as Category)
    : 'personal'

  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : newId(),
    text: typeof raw.text === 'string' ? raw.text : '',
    category,
    priority: ([0, 1, 2, 3] as number[]).includes(raw.priority as number)
      ? (raw.priority as Priority)
      : 2,
    estimate_minutes: typeof raw.estimate_minutes === 'number' ? raw.estimate_minutes : null,
    actual_minutes: typeof raw.actual_minutes === 'number' ? raw.actual_minutes : null,
    due: typeof raw.due === 'string' ? raw.due : null,
    scheduled_start: typeof raw.scheduled_start === 'string' ? raw.scheduled_start : null,
    scheduled_end: typeof raw.scheduled_end === 'string' ? raw.scheduled_end : null,
    status: (['open', 'doing', 'done', 'dropped'] as string[]).includes(raw.status as string)
      ? (raw.status as TodoStatus)
      : 'open',
    recurrence: (raw.recurrence ?? null) as Recurrence | null,
    recurrence_parent: typeof raw.recurrence_parent === 'string' ? raw.recurrence_parent : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string') : [],
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    source: (['app', 'telegram', 'import'] as string[]).includes(raw.source as string)
      ? (raw.source as Source)
      : 'app',
    created_at: created,
    updated_at: typeof raw.updated_at === 'number' ? raw.updated_at : created,
    completed_at: typeof raw.completed_at === 'number' ? raw.completed_at : null,
  }
}

async function readAll(): Promise<Todo[]> {
  return (await store.read()).map(normalize)
}

const isTemplate = (todo: Todo): boolean => todo.recurrence !== null
const isLive = (todo: Todo): boolean => todo.status === 'open' || todo.status === 'doing'

function sortForList(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    if (a.due !== b.due) {
      if (a.due === null) return 1
      if (b.due === null) return -1
      return a.due.localeCompare(b.due)
    }
    return b.created_at - a.created_at
  })
}

/** The order the day is worked through, and therefore the order overflow drops in. */
function sortForDay(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const aDue = a.due ?? '9999-12-31'
    const bDue = b.due ?? '9999-12-31'
    if (aDue !== bDue) return aDue.localeCompare(bDue)
    return a.created_at - b.created_at
  })
}

// --- recurrence materialization ------------------------------------------------------

function anchorOf(template: Todo): DateString {
  return template.due ?? toDateString(new Date(template.created_at))
}

/**
 * Bring every template's single live instance up to date for `date`, in place.
 *
 * The invariant is **exactly one live instance per template**, and this is what enforces
 * "recurrence never backlogs" (PRD T10). Coming back after a week away rolls the existing
 * instance forward onto today's occurrence rather than spawning one copy per missed day;
 * an instance the user dropped is never resurrected for the same occurrence.
 */
function materializeInto(todos: Todo[], date: DateString, now: number): boolean {
  let changed = false

  for (const template of todos) {
    if (!isTemplate(template) || template.status === 'dropped') continue
    const rule = template.recurrence
    if (rule === null) continue

    const occurrence = latestOccurrenceOnOrBefore(rule, anchorOf(template), date)
    if (occurrence === null) continue // the series has not started yet

    const instances = todos.filter((todo) => todo.recurrence_parent === template.id)
    const live = instances.find(isLive)

    if (live) {
      // A missed day does not pile up — it becomes today's copy of the same chore.
      if (live.due === null || live.due < occurrence) {
        Object.assign(live, scheduleOnDay(template, occurrence))
        live.due = occurrence
        live.updated_at = now
        changed = true
      }
      continue
    }

    // Nothing live. Only spawn if this exact occurrence was never dealt with, so a
    // completed or dropped instance is not resurrected.
    if (instances.some((todo) => todo.due === occurrence)) continue

    todos.push({
      ...template,
      id: newId(),
      due: occurrence,
      ...scheduleOnDay(template, occurrence),
      status: 'open',
      recurrence: null,
      recurrence_parent: template.id,
      actual_minutes: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    })
    changed = true
  }

  return changed
}

// --- validation ----------------------------------------------------------------------

function validateCreate(input: CreateTodoInput): void {
  const issues = new Issues()
  validateSchedule(input)
  checkNonEmptyText(issues, 'text', input.text)
  if (input.category !== undefined) checkCategory(issues, 'category', input.category)
  if (input.priority !== undefined) checkPriority(issues, 'priority', input.priority)
  if (input.status !== undefined) checkStatus(issues, 'status', input.status)
  if (input.source !== undefined) checkSource(issues, 'source', input.source)
  if (input.estimate_minutes !== undefined) {
    checkNonNegativeInt(issues, 'estimate_minutes', input.estimate_minutes)
  }
  if (input.actual_minutes !== undefined) {
    checkNonNegativeInt(issues, 'actual_minutes', input.actual_minutes)
  }
  if (input.due !== undefined && input.due !== null) checkDate(issues, 'due', input.due)
  if (input.tags !== undefined) checkTags(issues, 'tags', input.tags)
  checkRecurrence(issues, 'recurrence', input.recurrence)
  issues.throwIfAny()
}

function validateUpdate(updates: UpdateTodoInput): void {
  const issues = new Issues()
  if (updates.text !== undefined) checkNonEmptyText(issues, 'text', updates.text)
  if (updates.category !== undefined) checkCategory(issues, 'category', updates.category)
  if (updates.priority !== undefined) checkPriority(issues, 'priority', updates.priority)
  if (updates.status !== undefined) checkStatus(issues, 'status', updates.status)
  if (updates.source !== undefined) checkSource(issues, 'source', updates.source)
  if (updates.estimate_minutes !== undefined) {
    checkNonNegativeInt(issues, 'estimate_minutes', updates.estimate_minutes)
  }
  if (updates.actual_minutes !== undefined) {
    checkNonNegativeInt(issues, 'actual_minutes', updates.actual_minutes)
  }
  if (updates.due !== undefined && updates.due !== null) checkDate(issues, 'due', updates.due)
  if (updates.tags !== undefined) checkTags(issues, 'tags', updates.tags)
  if (updates.recurrence !== undefined) checkRecurrence(issues, 'recurrence', updates.recurrence)
  issues.throwIfAny()
}

// --- day load ------------------------------------------------------------------------

interface Interval {
  start: number
  end: number
}

/** Merge overlapping intervals so a double-booked hour is committed once, not twice. */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

function effectiveMinutes(todo: Todo, fallback: number): number {
  return todo.estimate_minutes ?? fallback
}

// --- public API ----------------------------------------------------------------------

export const todoRepository = {
  /**
   * Every todo the user can act on, all statuses, newest-relevant first.
   * Recurrence **templates are excluded** — a template is a rule, not a task, and it
   * never appears in a list (see `Todo.recurrence` in the shared contract).
   */
  async list(): Promise<Todo[]> {
    return sortForList((await readAll()).filter((todo) => !isTemplate(todo)))
  },

  /**
   * The recurrence templates themselves — the only route to a template id, and therefore
   * the only way a recurring task can be edited or turned off. A template is a rule, not a
   * task: it appears here and nowhere else.
   */
  async listTemplates(): Promise<Todo[]> {
    return sortForList((await readAll()).filter(isTemplate))
  },

  /**
   * Open and doing todos that are the user's problem on `date`: due that day, or overdue
   * and still not done (PRD T7 — overdue is unmissable). Undated todos are deliberately
   * excluded; folding the whole backlog into "due today" is what makes the headline
   * committed-vs-free number meaningless.
   *
   * Materializes recurrence instances as a side effect, so the ids returned are real and
   * completing one works.
   */
  async forDate(date: DateString): Promise<Todo[]> {
    const issues = new Issues()
    checkDate(issues, 'date', date)
    issues.throwIfAny()

    const todos = await store.mutate((current) => {
      const normalized = current.map(normalize)
      const changed = materializeInto(normalized, date, Date.now())
      return { data: normalized, result: normalized, write: changed }
    })

    return sortForDay(
      todos.filter(
        (todo) => !isTemplate(todo) && isLive(todo) && (
          scheduledWindow(todo)
            ? overlapsDay(todo.scheduled_start!, todo.scheduled_end!, date)
            : todo.due !== null && todo.due <= date
        )
      )
    )
  },

  async create(input: CreateTodoInput, importId?: string): Promise<Todo> {
    validateCreate(input)
    const settings = await settingsRepository.get()
    const now = Date.now()

    return store.mutate((current) => {
      const todos = current.map(normalize)
      const previous = importId ? todos.find((todo) => todo.id === importId) : undefined
      if (previous) return { data: current, result: previous, write: false }
      const todo: Todo = {
        id: importId ?? newId(),
        text: input.text.trim(),
        category: input.category ?? 'personal',
        priority: input.priority ?? settings.todos.default_priority,
        estimate_minutes:
          input.estimate_minutes === undefined
            ? settings.todos.default_estimate_minutes
            : input.estimate_minutes,
        actual_minutes: input.actual_minutes ?? null,
        due: input.scheduled_start ? localDay(new Date(input.scheduled_start)) : input.due ?? null,
        scheduled_start: input.scheduled_start ?? null,
        scheduled_end: input.scheduled_end ?? null,
        status: input.status ?? 'open',
        recurrence: input.recurrence ?? null,
        recurrence_parent: input.recurrence_parent ?? null,
        tags: input.tags ?? [],
        notes: input.notes ?? '',
        source: input.source ?? 'app',
        created_at: now,
        updated_at: now,
        completed_at: input.status === 'done' ? now : null,
      }

      // A template with no start date starts today, so its first instance shows up
      // immediately rather than on some arbitrary future day.
      if (todo.recurrence !== null && todo.due === null) {
        todo.due = todayString(new Date(now))
      }

      todos.push(todo)
      return { data: todos, result: todo }
    })
  },

  async update(id: string, updates: UpdateTodoInput): Promise<Todo> {
    validateUpdate(updates)

    return store.mutate((current) => {
      const todos = current.map(normalize)
      const index = todos.findIndex((todo) => todo.id === id)
      if (index === -1) throw new NotFoundError(`No todo with id ${id}`)

      const existing = todos[index] as Todo
      // Drop explicitly-undefined keys: `{ due: undefined }` survives structured clone
      // across IPC and would otherwise erase the field it was never meant to touch.
      const patch = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined)
      ) as UpdateTodoInput

      const next: Todo = {
        ...existing,
        ...patch,
        text: patch.text === undefined ? existing.text : patch.text.trim(),
        id: existing.id,
        created_at: existing.created_at,
        updated_at: Date.now(),
      }

      if (patch.due !== undefined && patch.scheduled_start === undefined && scheduledWindow(existing)) {
        Object.assign(next, patch.due ? scheduleOnDay(existing, patch.due) : { scheduled_start: null, scheduled_end: null })
      }
      validateSchedule(next)
      if (next.scheduled_start) next.due = localDay(new Date(next.scheduled_start))

      // Keep completed_at consistent with status without making the caller manage it.
      if (patch.status !== undefined && patch.completed_at === undefined) {
        next.completed_at = patch.status === 'done' ? (existing.completed_at ?? Date.now()) : null
      }

      todos[index] = next
      return { data: todos, result: next }
    })
  },

  /**
   * Complete a todo, banking `actual_minutes` for the calibration in T11, and spawn the
   * one next instance if this was a recurrence instance.
   */
  async complete(id: string, actualMinutes: number | null): Promise<Todo> {
    const issues = new Issues()
    checkNonNegativeInt(issues, 'actualMinutes', actualMinutes)
    issues.throwIfAny()

    const now = Date.now()
    const today = todayString(new Date(now))

    return store.mutate((current) => {
      const todos = current.map(normalize)
      const index = todos.findIndex((todo) => todo.id === id)
      if (index === -1) throw new NotFoundError(`No todo with id ${id}`)

      const existing = todos[index] as Todo
      if (isTemplate(existing)) {
        throw new ValidationError(
          `"${existing.text}" is a recurring template, not a task. Complete the instance ` +
            `it spawned instead.`
        )
      }

      const completed: Todo = {
        ...existing,
        status: 'done',
        actual_minutes: actualMinutes,
        completed_at: now,
        updated_at: now,
      }
      todos[index] = completed

      if (completed.recurrence_parent !== null) {
        const template = todos.find((todo) => todo.id === completed.recurrence_parent)
        if (template && template.recurrence !== null && template.status !== 'dropped') {
          // Base the next occurrence on today when the instance is being completed late,
          // so finishing Monday's chore on Friday schedules the next one forward, not
          // into a backlog.
          const base = completed.due !== null && completed.due > today ? completed.due : today
          const next = nextOccurrenceAfter(template.recurrence, anchorOf(template), base)

          const alreadyQueued = todos.some(
            (todo) => todo.recurrence_parent === template.id && (isLive(todo) || todo.due === next)
          )

          if (next !== null && !alreadyQueued) {
            todos.push({
              ...template,
              id: newId(),
              due: next,
              ...scheduleOnDay(template, next),
              status: 'open',
              recurrence: null,
              recurrence_parent: template.id,
              actual_minutes: null,
              completed_at: null,
              created_at: now,
              updated_at: now,
            })
          }
        }
      }

      return { data: todos, result: completed }
    })
  },

  async reopen(id: string): Promise<Todo> {
    return store.mutate((current) => {
      const todos = current.map(normalize)
      const index = todos.findIndex((todo) => todo.id === id)
      if (index === -1) throw new NotFoundError(`No todo with id ${id}`)

      const next: Todo = {
        ...(todos[index] as Todo),
        status: 'open',
        completed_at: null,
        updated_at: Date.now(),
      }
      todos[index] = next
      return { data: todos, result: next }
    })
  },

  /**
   * Deleting a template **detaches** its instances rather than deleting them.
   *
   * Cascading would be wrong twice over: the live instance may be half-finished work the
   * user is part-way through, and the completed ones are history that feeds the T11
   * correction factors — silently deleting them would move the calibration under the
   * user's feet. Detaching clears `recurrence_parent`, so each instance survives as an
   * ordinary one-off, no new ones are ever spawned, and no record is left pointing at a
   * template that no longer exists.
   */
  async remove(id: string): Promise<void> {
    await store.mutate((current) => {
      const todos = current.map(normalize)
      const target = todos.find((todo) => todo.id === id)
      if (!target) throw new NotFoundError(`No todo with id ${id}`)

      const remaining = todos.filter((todo) => todo.id !== id)

      if (isTemplate(target)) {
        const now = Date.now()
        for (const todo of remaining) {
          if (todo.recurrence_parent === id) {
            todo.recurrence_parent = null
            todo.updated_at = now
          }
        }
      }

      return { data: remaining, result: undefined }
    })
  },

  /**
   * "Is today realistic?" — PRD T5, the single most valuable number on the dashboard.
   * `now` is injectable so the calculation is testable without freezing the clock.
   */
  async dayLoad(date: DateString, now: Date = new Date()): Promise<DayLoad> {
    const issues = new Issues()
    checkDate(issues, 'date', date)
    issues.throwIfAny()

    const [todos, events, settings, factors] = await Promise.all([
      todoRepository.forDate(date),
      calendarRepository.forDate(date),
      settingsRepository.get(),
      todoRepository.correctionFactors(),
    ])

    const today = todayString(now)
    const windowStart =
      date === today ? Math.max(DAY_START_MINUTE, minutesSinceMidnight(now)) : DAY_START_MINUTE
    const windowEnd = DAY_END_MINUTE
    const windowLength = Math.max(0, windowEnd - windowStart)

    const busy = mergeIntervals(
      [...events, ...todos.map(scheduledEvent).filter((event): event is NonNullable<typeof event> => event !== null)]
        .filter((event) => !event.all_day && event.busy !== false)
        .map((event) => {
          const start = new Date(event.start)
          const end = new Date(event.end)
          if (Number.isNaN(start.getTime())) return null
          const startMinute = toDateString(start) < date ? 0 : minutesSinceMidnight(start)
          const endMinute =
            Number.isNaN(end.getTime()) || toDateString(end) > date
              ? DAY_END_MINUTE
              : minutesSinceMidnight(end)
          return { start: startMinute, end: Math.max(startMinute, endMinute) }
        })
        .filter((interval): interval is Interval => interval !== null)
    )

    const committed = busy.reduce((total, interval) => {
      const overlap = Math.min(interval.end, windowEnd) - Math.max(interval.start, windowStart)
      return total + Math.max(0, overlap)
    }, 0)

    const fallback = settings.todos.default_estimate_minutes
    const factorFor = new Map(factors.map((factor) => [factor.category, factor]))
    const anyConfident = factors.some((factor) => factor.confident)

    let dueMinutes = 0
    let correctedMinutes = 0
    for (const todo of todos.filter((item) => !scheduledWindow(item))) {
      const minutes = effectiveMinutes(todo, fallback)
      const factor = factorFor.get(todo.category)
      dueMinutes += minutes
      correctedMinutes += factor?.confident ? minutes * factor.factor : minutes
    }

    const freeMinutes = Math.max(0, windowLength - committed)

    // Walk the day in the order it would actually be worked; everything past the point
    // where the free time runs out is overflow, in that order.
    const overflow: Todo[] = []
    let spent = 0
    let overflowing = false
    for (const todo of todos.filter((item) => !scheduledWindow(item))) {
      const minutes = effectiveMinutes(todo, fallback)
      const factor = factorFor.get(todo.category)
      const realistic = factor?.confident ? minutes * factor.factor : minutes
      if (!overflowing && spent + realistic <= freeMinutes) {
        spent += realistic
      } else {
        overflowing = true
        overflow.push(todo)
      }
    }

    return {
      date,
      committed_minutes: Math.round(committed),
      free_minutes: Math.round(freeMinutes),
      due_minutes: Math.round(dueMinutes),
      corrected_due_minutes: anyConfident ? Math.round(correctedMinutes) : null,
      overflow,
    }
  },

  /**
   * Per-category estimate-vs-actual multiplier (PRD T11). Always returns one row per
   * category so the UI has something to bind to; `confident` is the flag that says
   * whether the number means anything yet.
   */
  async correctionFactors(): Promise<CorrectionFactor[]> {
    const todos = await readAll()

    return CATEGORIES.map((category) => {
      const samples = todos.filter(
        (todo) =>
          todo.category === category &&
          todo.status === 'done' &&
          typeof todo.estimate_minutes === 'number' &&
          todo.estimate_minutes > 0 &&
          typeof todo.actual_minutes === 'number' &&
          todo.actual_minutes >= 0
      )

      const estimated = samples.reduce((total, todo) => total + (todo.estimate_minutes ?? 0), 0)
      const actual = samples.reduce((total, todo) => total + (todo.actual_minutes ?? 0), 0)
      const factor = estimated > 0 ? actual / estimated : 1

      return {
        category,
        factor: Number(factor.toFixed(3)),
        sample_size: samples.length,
        confident: samples.length >= CORRECTION_CONFIDENCE_THRESHOLD,
      }
    })
  },

  /**
   * Everything on disk, templates and completed and dropped included. Not on `DesvuApi`
   * — this exists so search can reach records the default views hide (PRD S3).
   */
  async listAll(): Promise<Todo[]> {
    return readAll()
  },
}

export type TodoRepository = typeof todoRepository
