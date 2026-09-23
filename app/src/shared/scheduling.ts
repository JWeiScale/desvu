import type { CalendarEvent, DateString, Todo } from './types'

export function localDay(date: Date): DateString {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function shiftDay(day: DateString, count: number): DateString {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + count)
  return localDay(date)
}

export function dateTimeInput(iso?: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return `${localDay(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function scheduledWindow(todo: Pick<Todo, 'scheduled_start' | 'scheduled_end'>): { start: Date; end: Date } | null {
  if (!todo.scheduled_start || !todo.scheduled_end) return null
  const start = new Date(todo.scheduled_start)
  const end = new Date(todo.scheduled_end)
  return Number.isFinite(start.getTime()) && end > start ? { start, end } : null
}

/** Reject malformed or half-written blocks rather than silently moving a user's task. */
export function validateSchedule(todo: Pick<Todo, 'scheduled_start' | 'scheduled_end'>): void {
  const { scheduled_start: start, scheduled_end: end } = todo
  if (start == null && end == null) return
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/
  if (typeof start !== 'string' || typeof end !== 'string' || !iso.test(start) || !iso.test(end) || !scheduledWindow(todo)) {
    throw new Error('Choose a valid start and end time. The end must be after the start.')
  }
}

/** Recurring tasks keep the same local start time and elapsed duration across DST. */
export function scheduleOnDay(todo: Pick<Todo, 'scheduled_start' | 'scheduled_end'>, day: DateString): Pick<Todo, 'scheduled_start' | 'scheduled_end'> {
  const block = scheduledWindow(todo)
  if (!block) return { scheduled_start: null, scheduled_end: null }
  const start = new Date(`${day}T${dateTimeInput(todo.scheduled_start).slice(11)}:00`)
  return {
    scheduled_start: start.toISOString(),
    scheduled_end: new Date(start.getTime() + block.end.getTime() - block.start.getTime()).toISOString(),
  }
}

export function overlapsDay(start: string, end: string, day: DateString, allDay = false): boolean {
  if (allDay) return start.slice(0, 10) <= day && day < end.slice(0, 10)
  const from = new Date(`${day}T00:00:00`).getTime()
  const until = new Date(`${shiftDay(day, 1)}T00:00:00`).getTime()
  return Date.parse(start) < until && Date.parse(end) > from
}

export function scheduledEvent(todo: Todo): CalendarEvent | null {
  if (!scheduledWindow(todo)) return null
  return {
    id: `task:${todo.id}`, title: todo.text,
    start: todo.scheduled_start!, end: todo.scheduled_end!, all_day: false,
  }
}
