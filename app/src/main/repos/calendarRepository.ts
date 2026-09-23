import { overlapsDay, shiftDay } from '@shared/scheduling'
import { Issues, checkDate } from '../lib/validate'
import { stat } from 'node:fs/promises'
import type { CalendarEvent, DateString } from '@shared/types'
import { dataPath } from '@shared/vault'
import { toDateString } from '../lib/dates'
import { CorruptFileError, isErrnoException } from '../lib/errors'
import { createJsonStore } from '../lib/json-store'

/**
 * Cached calendar events, owned by the multi-account Google sync service.
 * A missing cache is normal before connecting Google. Legacy arrays and objects with
 * `events` plus a refresh timestamp are both accepted.
 */
interface CalendarFile {
  events?: unknown
  last_refresh?: unknown
  lastRefresh?: unknown
  refreshed_at?: unknown
}

type CalendarContents = { events: CalendarEvent[]; lastRefresh: number | null }

const store = createJsonStore<unknown>(
  () => dataPath('calendar.json'),
  () => null,
  (parsed) => parsed
)

function coerceEvent(value: unknown): CalendarEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const start = typeof raw.start === 'string' ? raw.start : null
  const title = typeof raw.title === 'string' ? raw.title : null
  if (!start || !title) return null

  const event: CalendarEvent = {
    id: typeof raw.id === 'string' ? raw.id : `${start}-${title}`,
    title,
    start,
    end: typeof raw.end === 'string' ? raw.end : start,
    all_day: raw.all_day === true,
  }
  for (const key of ['location', 'account_email', 'calendar_id', 'calendar_name', 'color'] as const) {
    if (typeof raw[key] === 'string') event[key] = raw[key]
  }
  if (typeof raw.busy === 'boolean') event.busy = raw.busy
  return event
}

async function readContents(): Promise<CalendarContents> {
  const parsed = await store.read()
  if (parsed === null || parsed === undefined) return { events: [], lastRefresh: null }

  if (Array.isArray(parsed)) {
    return { events: parsed.map(coerceEvent).filter((e): e is CalendarEvent => e !== null), lastRefresh: await fileMtime() }
  }

  if (typeof parsed !== 'object') {
    throw new CorruptFileError(store.filePath(), 'expected an array of events or an object')
  }

  const file = parsed as CalendarFile
  const events = Array.isArray(file.events)
    ? file.events.map(coerceEvent).filter((e): e is CalendarEvent => e !== null)
    : []

  const stamp = file.last_refresh ?? file.lastRefresh ?? file.refreshed_at
  let lastRefresh: number | null = null
  if (typeof stamp === 'number' && Number.isFinite(stamp)) lastRefresh = stamp
  else if (typeof stamp === 'string') {
    const parsedStamp = Date.parse(stamp)
    if (!Number.isNaN(parsedStamp)) lastRefresh = parsedStamp
  }

  return { events, lastRefresh: lastRefresh ?? (await fileMtime()) }
}

async function fileMtime(): Promise<number | null> {
  try {
    const info = await stat(store.filePath())
    return info.mtimeMs
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}

/** Local calendar day an ISO instant falls on. */
export function eventDate(isoString: string): DateString | null {
  const parsed = new Date(isoString)
  if (Number.isNaN(parsed.getTime())) return null
  return toDateString(parsed)
}

export function validateCalendarRange(from: string, to: string): void {
  const issues = new Issues()
  checkDate(issues, 'from', from)
  checkDate(issues, 'to', to)
  issues.throwIfAny()
  if (from > to || to > shiftDay(from, 366)) throw new Error('Choose a calendar range of at most one year.')
}

export const calendarRepository = {
  async forRange(from: DateString, to: DateString): Promise<CalendarEvent[]> {
    validateCalendarRange(from, to)
    const { events } = await readContents()
    return events.filter((event) => event.all_day
      ? event.start.slice(0, 10) <= to && event.end.slice(0, 10) > from
      : Date.parse(event.start) < new Date(`${shiftDay(to, 1)}T00:00:00`).getTime() &&
        Date.parse(event.end) > new Date(`${from}T00:00:00`).getTime())
      .sort((a, b) => a.start.localeCompare(b.start))
  },

  async replaceAccountEvents(email: string, events: CalendarEvent[], from?: string, to?: string): Promise<void> {
    await store.mutate((raw) => {
      const file = raw && !Array.isArray(raw) && typeof raw === 'object' ? raw as CalendarFile : {}
      const previous = (Array.isArray(raw) ? raw : Array.isArray(file.events) ? file.events : [])
        .map(coerceEvent).filter((event): event is CalendarEvent => event !== null)
      const kept = previous.filter((event) => {
        if (event.account_email !== email) return true
        if (!from || !to) return false
        return event.all_day ? event.end.slice(0, 10) <= from || event.start.slice(0, 10) > to
          : Date.parse(event.end) <= new Date(`${from}T00:00:00`).getTime() ||
            Date.parse(event.start) >= new Date(`${shiftDay(to, 1)}T00:00:00`).getTime()
      })
      return { data: { last_refresh: Date.now(), events: [...kept, ...events] }, result: undefined }
    })
  },

  async forDate(date: DateString): Promise<CalendarEvent[]> {
    const { events } = await readContents()
    return events
      .filter((event) => overlapsDay(event.start, event.end, date, event.all_day))
      .sort((a, b) => a.start.localeCompare(b.start))
  },

  async lastRefresh(): Promise<number | null> {
    const { lastRefresh } = await readContents()
    return lastRefresh
  },

  /** Everything, for search and diagnostics. */
  async listAll(): Promise<CalendarEvent[]> {
    const { events } = await readContents()
    return events
  },
}

export type CalendarRepository = typeof calendarRepository
