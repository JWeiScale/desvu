import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Category, Todo } from '@shared/types'
import { todoRepository } from '../src/main/repos/todoRepository'
import { createTempVault, dayOffset, type TempVault } from './helpers/vault'

let vault: TempVault

beforeEach(async () => {
  vault = await createTempVault('todos')
})

afterEach(async () => {
  await vault.dispose()
})

const today = () => dayOffset(0)

describe('todo crud and validation', () => {
  it.each<Category>(['ml-systems', 'reinforcement-learning'])(
    'preserves %s through saving, editing, and recurring task creation',
    async (category) => {
      const created = await todoRepository.create({ text: 'Read a paper', category, due: today() })
      await todoRepository.update(created.id, { text: 'Read and annotate a paper' })
      const saved = (await todoRepository.list()).find((todo) => todo.id === created.id)
      expect(saved).toMatchObject({ category, text: 'Read and annotate a paper' })

      const template = await todoRepository.create({
        text: 'Review research notes', category, due: today(),
        recurrence: { type: 'daily', interval: 1 },
      })
      const tasks = await todoRepository.forDate(today())
      expect(tasks.find((todo) => todo.recurrence_parent === template.id)?.category).toBe(category)
      expect((await todoRepository.correctionFactors()).find((factor) => factor.category === category))
        .toMatchObject({ sample_size: 0, confident: false })
    }
  )

  it('applies settings defaults on create', async () => {
    const todo = await todoRepository.create({ text: 'email the Ramp recruiter' })
    expect(todo.priority).toBe(2)
    expect(todo.estimate_minutes).toBe(30)
    expect(todo.category).toBe('personal')
    expect(todo.status).toBe('open')
    expect(todo.source).toBe('app')
  })

  it('rejects an unknown category with a message naming the allowed values', async () => {
    await expect(
      todoRepository.create({ text: 'x', category: 'work' as never })
    ).rejects.toThrow(/category must be one of personal, school, recruiting/)
  })

  it('rejects a negative estimate', async () => {
    await expect(
      todoRepository.create({ text: 'x', estimate_minutes: -5 })
    ).rejects.toThrow(/estimate_minutes cannot be negative/)
  })

  it('rejects empty text and reports every problem at once', async () => {
    await expect(
      todoRepository.create({ text: '   ', priority: 9 as never, due: 'yesterday' })
    ).rejects.toThrow(/text cannot be empty.*priority.*due/s)
  })

  it('rejects a malformed recurrence rule', async () => {
    await expect(
      todoRepository.create({
        text: 'gym',
        recurrence: { type: 'weekly', interval: 1, days: ['funday'] } as never,
      })
    ).rejects.toThrow(/unknown weekday/)
  })

  it('updates, reopens and removes', async () => {
    const todo = await todoRepository.create({ text: 'malloc lab', category: 'school' })

    const updated = await todoRepository.update(todo.id, { priority: 1, notes: 'due friday' })
    expect(updated.priority).toBe(1)
    expect(updated.notes).toBe('due friday')
    expect(updated.updated_at).toBeGreaterThanOrEqual(todo.updated_at)

    const done = await todoRepository.update(todo.id, { status: 'done' })
    expect(done.completed_at).not.toBeNull()

    const reopened = await todoRepository.reopen(todo.id)
    expect(reopened.status).toBe('open')
    expect(reopened.completed_at).toBeNull()

    await todoRepository.remove(todo.id)
    await expect(todoRepository.list()).resolves.toEqual([])
  })

  it('reports a clear error for an unknown id', async () => {
    await expect(todoRepository.update('nope', { priority: 1 })).rejects.toThrow(
      /No todo with id nope/
    )
  })
})

describe('forDate', () => {
  it('returns todos due that day and overdue ones, but not undated backlog', async () => {
    await todoRepository.create({ text: 'due today', due: today() })
    await todoRepository.create({ text: 'overdue', due: dayOffset(-3) })
    await todoRepository.create({ text: 'later', due: dayOffset(3) })
    await todoRepository.create({ text: 'someday, no date' })

    const list = await todoRepository.forDate(today())
    expect(list.map((todo) => todo.text).sort()).toEqual(['due today', 'overdue'])
  })

  it('excludes completed and dropped todos', async () => {
    const done = await todoRepository.create({ text: 'finished', due: today() })
    await todoRepository.complete(done.id, 20)
    const dropped = await todoRepository.create({ text: 'abandoned', due: today() })
    await todoRepository.update(dropped.id, { status: 'dropped' })

    await expect(todoRepository.forDate(today())).resolves.toEqual([])
  })
})

describe('recurrence', () => {
  const dailyTemplate = () =>
    todoRepository.create({
      text: 'gym',
      category: 'personal',
      estimate_minutes: 60,
      recurrence: { type: 'daily', interval: 1 },
      due: dayOffset(-10),
    })

  it('keeps templates out of every list', async () => {
    await dailyTemplate()
    const list = await todoRepository.list()
    expect(list.every((todo) => todo.recurrence === null)).toBe(true)
  })

  it('surfaces templates only through listTemplates, never through list or forDate', async () => {
    const template = await dailyTemplate()
    await todoRepository.create({ text: 'an ordinary todo', due: today() })

    const templates = await todoRepository.listTemplates()
    expect(templates.map((todo) => todo.id)).toEqual([template.id])
    expect(templates[0]?.recurrence).toEqual({ type: 'daily', interval: 1 })

    expect((await todoRepository.list()).map((todo) => todo.id)).not.toContain(template.id)
    expect((await todoRepository.forDate(today())).map((todo) => todo.id)).not.toContain(
      template.id
    )
  })

  it('does not report materialized instances as templates', async () => {
    await dailyTemplate()
    await todoRepository.forDate(today())

    const templates = await todoRepository.listTemplates()
    expect(templates).toHaveLength(1)
    expect(templates.every((todo) => todo.recurrence !== null)).toBe(true)
    expect(templates.every((todo) => todo.recurrence_parent === null)).toBe(true)
  })

  it('returns nothing when no recurring task has ever been created', async () => {
    await todoRepository.create({ text: 'a one-off' })
    await expect(todoRepository.listTemplates()).resolves.toEqual([])
  })

  it('lets a template found through listTemplates be edited and turned off', async () => {
    await dailyTemplate()
    const [template] = await todoRepository.listTemplates()
    expect(template).toBeDefined()

    // Editing the rule affects future instances only — the id is reachable, which is the
    // whole point of listTemplates.
    const edited = await todoRepository.update((template as Todo).id, {
      recurrence: { type: 'weekly', interval: 1, days: ['mon'] },
      text: 'gym (mondays only)',
    })
    expect(edited.recurrence).toEqual({ type: 'weekly', interval: 1, days: ['mon'] })

    await todoRepository.remove((template as Todo).id)
    await expect(todoRepository.listTemplates()).resolves.toEqual([])
  })

  it('materializes exactly one instance after a ten-day absence — no backlog', async () => {
    await dailyTemplate()

    const day = await todoRepository.forDate(today())
    expect(day).toHaveLength(1)
    expect(day[0]?.due).toBe(today())
    expect(day[0]?.recurrence).toBeNull()
    expect(day[0]?.estimate_minutes).toBe(60)

    const all = await todoRepository.listAll()
    expect(all.filter((todo) => todo.recurrence_parent !== null)).toHaveLength(1)
  })

  it('is idempotent — repeated reads never stack up copies', async () => {
    await dailyTemplate()
    await todoRepository.forDate(today())
    await todoRepository.forDate(today())
    await todoRepository.forDate(today())

    const instances = (await todoRepository.listAll()).filter(
      (todo) => todo.recurrence_parent !== null
    )
    expect(instances).toHaveLength(1)
  })

  it('rolls a missed instance forward instead of leaving one copy per missed day', async () => {
    await dailyTemplate()

    // Open the day view three days ago, then not again until today.
    const past = await todoRepository.forDate(dayOffset(-3))
    expect(past).toHaveLength(1)
    const originalId = past[0]?.id

    const now = await todoRepository.forDate(today())
    expect(now).toHaveLength(1)
    expect(now[0]?.id).toBe(originalId)
    expect(now[0]?.due).toBe(today())
  })

  it('spawns exactly the next instance on completion', async () => {
    await dailyTemplate()
    const [instance] = await todoRepository.forDate(today())
    expect(instance).toBeDefined()

    const completed = await todoRepository.complete((instance as Todo).id, 55)
    expect(completed.status).toBe('done')
    expect(completed.actual_minutes).toBe(55)

    const instances = (await todoRepository.listAll()).filter(
      (todo) => todo.recurrence_parent !== null
    )
    expect(instances).toHaveLength(2)

    const open = instances.filter((todo) => todo.status === 'open')
    expect(open).toHaveLength(1)
    expect(open[0]?.due).toBe(dayOffset(1))
  })

  it('schedules forward when an instance is completed late', async () => {
    // Anchored well in the past; the instance materializes as "today" and completing it
    // must schedule tomorrow, never a date already gone.
    await todoRepository.create({
      text: 'weekly review',
      recurrence: { type: 'weekly', interval: 1, days: ['mon', 'wed', 'fri'] },
      due: dayOffset(-40),
    })

    const [instance] = await todoRepository.forDate(today())
    if (instance) {
      const before = instance.due ?? today()
      await todoRepository.complete(instance.id, null)
      const open = (await todoRepository.listAll()).filter(
        (todo) => todo.recurrence_parent !== null && todo.status === 'open'
      )
      expect(open).toHaveLength(1)
      expect(open[0]?.due ?? '').toBeTruthy()
      expect((open[0]?.due ?? '') > before).toBe(true)
      expect((open[0]?.due ?? '') > dayOffset(-1)).toBe(true)
    }
  })

  it('never resurrects an instance the user dropped', async () => {
    await dailyTemplate()
    const [instance] = await todoRepository.forDate(today())
    await todoRepository.update((instance as Todo).id, { status: 'dropped' })

    await expect(todoRepository.forDate(today())).resolves.toEqual([])
    const instances = (await todoRepository.listAll()).filter(
      (todo) => todo.recurrence_parent !== null
    )
    expect(instances).toHaveLength(1)
    expect(instances[0]?.status).toBe('dropped')
  })

  it('refuses to complete a template directly', async () => {
    const template = await dailyTemplate()
    await expect(todoRepository.complete(template.id, 30)).rejects.toThrow(
      /recurring template/
    )
  })

  it('detaches instances when the template is deleted, so half-done work survives', async () => {
    const template = await dailyTemplate()
    const [instance] = await todoRepository.forDate(today())
    expect(instance).toBeDefined()

    // The user is part-way through today's gym session when they turn the rule off.
    await todoRepository.update((instance as Todo).id, { status: 'doing' })
    await todoRepository.remove(template.id)

    const remaining = await todoRepository.listAll()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe((instance as Todo).id)
    expect(remaining[0]?.status).toBe('doing')
    // It is now an ordinary one-off: no dangling pointer to a template that is gone.
    expect(remaining[0]?.recurrence_parent).toBeNull()
    expect(remaining[0]?.recurrence).toBeNull()

    // It still shows up as normal work, and no new instance is ever spawned again.
    const day = await todoRepository.forDate(today())
    expect(day.map((todo) => todo.id)).toEqual([(instance as Todo).id])
  })

  it('keeps completed instances as history when the template is deleted', async () => {
    const template = await dailyTemplate()
    const [instance] = await todoRepository.forDate(today())
    await todoRepository.complete((instance as Todo).id, 55)

    await todoRepository.remove(template.id)

    const remaining = await todoRepository.listAll()
    // The completed instance and the one its completion spawned both survive, detached.
    expect(remaining.every((todo) => todo.recurrence_parent === null)).toBe(true)
    const completed = remaining.find((todo) => todo.status === 'done')
    expect(completed?.actual_minutes).toBe(55)
  })

  it('leaves the calibration data intact when a recurring rule is turned off', async () => {
    // Cascading deletes would silently move the T11 correction factor under the user.
    const template = await todoRepository.create({
      text: 'daily standup',
      category: 'school',
      estimate_minutes: 60,
      recurrence: { type: 'daily', interval: 1 },
      due: dayOffset(-1),
    })
    const [instance] = await todoRepository.forDate(today())
    await todoRepository.complete((instance as Todo).id, 90)

    const before = (await todoRepository.correctionFactors()).find(
      (factor) => factor.category === 'school'
    )
    await todoRepository.remove(template.id)
    const after = (await todoRepository.correctionFactors()).find(
      (factor) => factor.category === 'school'
    )

    expect(after?.sample_size).toBe(before?.sample_size)
    expect(after?.factor).toBe(before?.factor)
    expect(after?.sample_size).toBe(1)
  })

  it('honours a monthly rule', async () => {
    await todoRepository.create({
      text: 'pay rent',
      recurrence: { type: 'monthly', interval: 1, day_of_month: 1 },
      due: dayOffset(-90),
    })

    const day = await todoRepository.forDate(today())
    expect(day).toHaveLength(1)
    expect(day[0]?.due?.endsWith('-01')).toBe(true)
  })
})

describe('correction factors (T11)', () => {
  async function seedCompletions(count: number, estimate: number, actual: number): Promise<void> {
    const now = Date.now()
    await vault.writeJson(
      'data/todos.json',
      Array.from({ length: count }, (_, index) => ({
        id: `seed-${index}`,
        text: `school task ${index}`,
        category: 'school',
        priority: 2,
        estimate_minutes: estimate,
        actual_minutes: actual,
        due: null,
        status: 'done',
        recurrence: null,
        recurrence_parent: null,
        tags: [],
        notes: '',
        source: 'app',
        created_at: now,
        updated_at: now,
        completed_at: now,
      }))
    )
  }

  it('returns a row per category with a neutral factor when there is no data', async () => {
    const factors = await todoRepository.correctionFactors()
    expect(factors.map((factor) => factor.category)).toEqual([
      'personal',
      'school',
      'recruiting',
      'ml-systems',
      'reinforcement-learning',
    ])
    expect(factors.every((factor) => factor.factor === 1 && !factor.confident)).toBe(true)
  })

  it('is not confident below ~25 completions', async () => {
    await seedCompletions(24, 60, 90)
    const school = (await todoRepository.correctionFactors()).find(
      (factor) => factor.category === 'school'
    )
    expect(school?.sample_size).toBe(24)
    expect(school?.factor).toBeCloseTo(1.5, 3)
    expect(school?.confident).toBe(false)
  })

  it('becomes confident at 25 completions', async () => {
    await seedCompletions(25, 60, 90)
    const school = (await todoRepository.correctionFactors()).find(
      (factor) => factor.category === 'school'
    )
    expect(school?.sample_size).toBe(25)
    expect(school?.confident).toBe(true)
  })
})

describe('dayLoad (T5)', () => {
  const future = () => dayOffset(4)

  it('reports due minutes against a free day when there is no calendar', async () => {
    await todoRepository.create({ text: 'a', due: future(), estimate_minutes: 120 })
    await todoRepository.create({ text: 'b', due: future(), estimate_minutes: 90 })

    const load = await todoRepository.dayLoad(future())
    expect(load.date).toBe(future())
    expect(load.due_minutes).toBe(210)
    expect(load.committed_minutes).toBe(0)
    expect(load.free_minutes).toBe(960)
    expect(load.overflow).toEqual([])
    expect(load.corrected_due_minutes).toBeNull()
  })

  /** An ISO instant that lands on the given *local* wall-clock time, whatever the TZ. */
  function localIso(date: string, hour: number, minute = 0): string {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number]
    return new Date(year, month - 1, day, hour, minute).toISOString()
  }

  it('subtracts calendar commitments, counting a double booking once', async () => {
    await vault.writeJson('data/calendar.json', {
      last_refresh: Date.now(),
      events: [
        {
          id: '1',
          title: 'lecture',
          start: localIso(future(), 10),
          end: localIso(future(), 12),
          all_day: false,
        },
        {
          id: '2',
          title: 'overlapping office hours',
          start: localIso(future(), 11),
          end: localIso(future(), 13),
          all_day: false,
        },
        {
          id: '3',
          title: 'someone`s birthday',
          start: localIso(future(), 0),
          end: localIso(future(), 0),
          all_day: true,
        },
      ],
    })

    const load = await todoRepository.dayLoad(future())
    expect(load.committed_minutes).toBe(180)
    expect(load.free_minutes).toBe(960 - 180)
  })

  it('overflows the todos that do not fit, in the order they would be worked', async () => {
    await todoRepository.create({
      text: 'first',
      due: future(),
      estimate_minutes: 600,
      priority: 0,
    })
    await todoRepository.create({
      text: 'second',
      due: future(),
      estimate_minutes: 600,
      priority: 1,
    })
    await todoRepository.create({
      text: 'third',
      due: future(),
      estimate_minutes: 600,
      priority: 2,
    })

    const load = await todoRepository.dayLoad(future())
    expect(load.due_minutes).toBe(1800)
    expect(load.overflow.map((todo) => todo.text)).toEqual(['second', 'third'])
  })

  it('scales by the correction factor once a category is confident', async () => {
    const now = Date.now()
    const completions = Array.from({ length: 25 }, (_, index) => ({
      id: `seed-${index}`,
      text: `school ${index}`,
      category: 'school',
      priority: 2,
      estimate_minutes: 60,
      actual_minutes: 120,
      due: null,
      status: 'done',
      recurrence: null,
      recurrence_parent: null,
      tags: [],
      notes: '',
      source: 'app',
      created_at: now,
      updated_at: now,
      completed_at: now,
    }))
    await vault.writeJson('data/todos.json', completions)

    await todoRepository.create({
      text: 'problem set',
      category: 'school',
      due: future(),
      estimate_minutes: 100,
    })

    const load = await todoRepository.dayLoad(future())
    expect(load.due_minutes).toBe(100)
    expect(load.corrected_due_minutes).toBe(200)
  })

  it('rejects a date that is not a real day', async () => {
    await expect(todoRepository.dayLoad('2026-13-40')).rejects.toThrow(/YYYY-MM-DD/)
  })
})
