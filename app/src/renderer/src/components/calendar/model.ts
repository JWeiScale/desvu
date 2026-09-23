import type { CalendarEvent, Todo } from '@shared/types'
import { localDay, overlapsDay, scheduledWindow, shiftDay } from '@shared/scheduling'
export type CalendarView = 'day' | 'week' | 'month'
export interface CalendarItem {
  id: string; title: string; start: string; end: string; allDay: boolean
  task?: Todo; event?: CalendarEvent; color?: string
}
export function visibleDays(anchor: string, view: CalendarView): string[] {
  if (view === 'day') return [anchor]
  const date = new Date(`${view === 'month' ? anchor.slice(0, 7) + '-01' : anchor}T12:00:00`)
  date.setDate(date.getDate() - (date.getDay() + 6) % 7)
  return Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => shiftDay(localDay(date), i))
}
export function itemsForDay(todos: readonly Todo[], events: readonly CalendarEvent[], day: string): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const event of events) if (overlapsDay(event.start, event.end, day, event.all_day)) {
    items.push({ id: `event:${event.id}`, title: event.title, start: event.start, end: event.end, allDay: event.all_day, event, color: event.color })
  }
  for (const task of todos) {
    if (task.recurrence || task.status === 'dropped') continue
    if (scheduledWindow(task)) {
      if (overlapsDay(task.scheduled_start!, task.scheduled_end!, day)) items.push({ id: `task:${task.id}`, title: task.text,
        start: task.scheduled_start!, end: task.scheduled_end!, allDay: false, task })
    } else if (task.due === day) items.push({ id: `task:${task.id}`, title: task.text, start: day, end: shiftDay(day, 1), allDay: true, task })
  }
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}
export interface PositionedItem extends CalendarItem { startMinute: number; endMinute: number; column: number; columns: number }
/** Interval coloring gives concurrent meetings separate columns instead of hiding them. */
export function positionItems(items: CalendarItem[], day: string): PositionedItem[] {
  const positioned = items.filter((item) => !item.allDay).map((item) => {
    const start = new Date(item.start), end = new Date(item.end)
    const startMinute = localDay(start) < day ? 0 : start.getHours() * 60 + start.getMinutes()
    const endMinute = localDay(end) > day ? 1440 : end.getHours() * 60 + end.getMinutes()
    return { ...item, startMinute, endMinute: Math.max(startMinute + 15, endMinute), column: 0, columns: 1 }
  }).sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute)
  let group: PositionedItem[] = [], ends: number[] = [], groupEnd = -1
  const finish = () => { for (const item of group) item.columns = ends.length; group = []; ends = [] }
  for (const item of positioned) {
    if (item.startMinute >= groupEnd) { finish(); groupEnd = -1 }
    let column = ends.findIndex((end) => end <= item.startMinute)
    if (column === -1) column = ends.length
    ends[column] = item.endMinute; item.column = column
    group.push(item); groupEnd = Math.max(groupEnd, item.endMinute)
  }
  finish()
  return positioned
}
export function taskAtTime(task: Todo, day: string, minute: number) {
  const start = new Date(`${day}T00:00:00`)
  start.setMinutes(minute)
  const old = scheduledWindow(task)
  const length = old ? old.end.getTime() - old.start.getTime() : Math.max(15, task.estimate_minutes ?? 30) * 60000
  return { scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + length).toISOString(), due: day }
}
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
