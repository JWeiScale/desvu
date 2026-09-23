import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { localDay, overlapsDay, scheduleOnDay, dateTimeInput } from '@shared/scheduling'
import { todoRepository } from '../src/main/repos/todoRepository'
import { calendarRepository } from '../src/main/repos/calendarRepository'
import { itemsForDay, positionItems, taskAtTime, visibleDays, type CalendarItem } from '../src/renderer/src/components/calendar/model'
import { createTempVault, type TempVault } from './helpers/vault'

let vault: TempVault
beforeEach(async () => { vault = await createTempVault('scheduling') })
afterEach(async () => { vi.useRealTimers(); await vault.dispose() })
const iso = (day: string, time: string) => new Date(`${day}T${time}:00`).toISOString()
const day = '2026-09-22'
const block = { scheduled_start: iso(day, '09:00'), scheduled_end: iso(day, '10:00') }

describe('task scheduling persistence', () => {
  it('creates, edits the day, and removes a time without losing the task', async () => {
    const task = await todoRepository.create({ text: 'Read RL paper', category: 'reinforcement-learning', ...block })
    expect(task.due).toBe(day)
    const moved = await todoRepository.update(task.id, { due: '2026-09-24' })
    expect(dateTimeInput(moved.scheduled_start)).toBe('2026-09-24T09:00')
    expect(dateTimeInput(moved.scheduled_end)).toBe('2026-09-24T10:00')
    const saved = JSON.parse(await readFile(vault.at('data/todos.json'), 'utf8'))
    expect(saved.find((t: { id: string }) => t.id === task.id)).toMatchObject({ ...moved })
    expect(await todoRepository.forDate(day)).toEqual([])
    expect((await todoRepository.forDate('2026-09-24')).map((t) => t.id)).toEqual([task.id])
    expect(await todoRepository.forDate('2026-09-25')).toEqual([])
    await todoRepository.update(task.id, { scheduled_start: null, scheduled_end: null })
    expect((await todoRepository.list())[0]).toMatchObject({ text: 'Read RL paper', due: '2026-09-24', scheduled_start: null, scheduled_end: null })
  })

  it('clearing the due date clears a scheduled block', async () => {
    const task = await todoRepository.create({ text: 'Read', ...block })
    expect(await todoRepository.update(task.id, { due: null })).toMatchObject({ due: null, scheduled_start: null, scheduled_end: null })
  })

  it('rejects partial, backward, and offset-free schedules without altering storage', async () => {
    const task = await todoRepository.create({ text: 'Read', ...block })
    const before = await readFile(vault.at('data/todos.json'), 'utf8')
    for (const patch of [{ scheduled_end: null }, { scheduled_end: block.scheduled_start }, { scheduled_start: '2026-09-22T09:00' }]) {
      await expect(todoRepository.update(task.id, patch)).rejects.toThrow(/start and end time/)
    }
    await expect(todoRepository.create({ text: 'Bad', scheduled_start: block.scheduled_start })).rejects.toThrow()
    expect(await readFile(vault.at('data/todos.json'), 'utf8')).toBe(before)
  })

  it('carries local times into recurring instances and the next occurrence', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${day}T12:00:00`))
    const template = await todoRepository.create({ text: 'Daily review', ...block, recurrence: { type: 'daily', interval: 1 } })
    const [instance] = await todoRepository.forDate(day)
    expect(instance).toMatchObject({ ...block, recurrence_parent: template.id })
    await todoRepository.complete(instance!.id, 30)
    const next = (await todoRepository.list()).find((t) => t.status === 'open')!
    expect(dateTimeInput(next.scheduled_start)).toBe('2026-09-23T09:00')
    expect(dateTimeInput(next.scheduled_end)).toBe('2026-09-23T10:00')
  })

  it('preserves the local start and elapsed duration over daylight saving changes', () => {
    const source = { scheduled_start: iso('2026-03-07', '09:00'), scheduled_end: iso('2026-03-07', '10:00') }
    const moved = scheduleOnDay(source, '2026-03-08')
    expect(dateTimeInput(moved.scheduled_start)).toBe('2026-03-08T09:00')
    expect(Date.parse(moved.scheduled_end!) - Date.parse(moved.scheduled_start!)).toBe(3600000)
  })

  it('reserves scheduled blocks once, including overlaps with meetings', async () => {
    await todoRepository.create({ text: 'Fixed', ...block, estimate_minutes: 60 })
    await todoRepository.create({ text: 'Flexible', due: day, estimate_minutes: 30 })
    await vault.writeJson('data/calendar.json', [{ id: 'meeting', title: 'Meeting', start: iso(day, '09:30'), end: iso(day, '10:30'), all_day: false },
      { id: 'free', title: 'FYI', start: iso(day, '13:00'), end: iso(day, '14:00'), all_day: false, busy: false }])
    expect(await todoRepository.dayLoad(day, new Date(`${day}T08:00:00`))).toMatchObject({ committed_minutes: 90, due_minutes: 30, overflow: [] })
  })
})

describe('calendar dates and layout', () => {
  it('uses end-exclusive dates for all-day events and midnight boundaries', async () => {
    const event = { id: 'trip', title: 'Trip', start: '2026-09-22', end: '2026-09-24', all_day: true }
    await vault.writeJson('data/calendar.json', [event])
    expect(await calendarRepository.forDate('2026-09-23')).toEqual([event])
    expect(await calendarRepository.forDate('2026-09-24')).toEqual([])
    expect(overlapsDay(iso(day, '23:00'), iso('2026-09-23', '00:00'), '2026-09-23')).toBe(false)
    expect(overlapsDay(iso(day, '23:00'), iso('2026-09-23', '01:00'), '2026-09-23')).toBe(true)
    await expect(calendarRepository.forRange('bad', day)).rejects.toThrow()
    await expect(calendarRepository.forRange(day, '2028-09-22')).rejects.toThrow()
  })

  it('keeps weeks Monday-first and month grids complete across year boundaries', () => {
    expect(visibleDays('2026-09-22', 'week')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])
    const month = visibleDays('2027-01-10', 'month')
    expect(month).toHaveLength(42)
    expect(month[0]).toBe('2026-12-28')
    expect(month[41]).toBe('2027-02-07')
  })

  it('gives overlaps separate columns and adjacent meetings their full width', () => {
    const item = (id: string, start: string, end: string): CalendarItem => ({ id, title: id, start: iso(day, start), end: iso(day, end), allDay: false })
    const result = positionItems([item('a', '09:00', '10:00'), item('b', '09:30', '10:30'), item('c', '10:00', '10:45'), item('d', '10:45', '11:30')], day)
    expect(result.map(({ id, column, columns }) => ({ id, column, columns }))).toEqual([
      { id: 'a', column: 0, columns: 2 }, { id: 'b', column: 1, columns: 2 }, { id: 'c', column: 0, columns: 2 }, { id: 'd', column: 0, columns: 1 },
    ])
  })

  it('displays scheduled and untimed tasks and preserves duration when dragged', async () => {
    const timed = await todoRepository.create({ text: 'Timed', ...block })
    const untimed = await todoRepository.create({ text: 'Untimed', due: day })
    const items = itemsForDay([timed, untimed], [], day)
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.task?.id === untimed.id)?.allDay).toBe(true)
    expect(itemsForDay([timed], [], '2026-09-23')).toEqual([])
    const moved = taskAtTime(timed, '2026-09-24', 14 * 60 + 30)
    expect(dateTimeInput(moved.scheduled_start)).toBe('2026-09-24T14:30')
    expect(dateTimeInput(moved.scheduled_end)).toBe('2026-09-24T15:30')
    expect(localDay(new Date(moved.scheduled_start))).toBe(moved.due)
  })
})
