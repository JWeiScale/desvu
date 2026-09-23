import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CreateGoalInput, UpdateGoalInput } from '@shared/types'
import { goalDaysRemaining, goalDeadlineLabel } from '@shared/goals'
import { goalRepository } from '../src/main/repos/goalRepository'
import { searchRepository } from '../src/main/repos/searchRepository'
import { primaryAction } from '../src/renderer/src/components/search/search'
import { createTempVault, type TempVault } from './helpers/vault'

let vault: TempVault
beforeEach(async () => { vault = await createTempVault('goals') })
afterEach(async () => { await vault.dispose() })

const input = { title: 'Read the RL textbook', deadline: '2026-10-15', notes: 'Finish the exercises' }
const contents = (): Promise<string> => readFile(vault.at('data/goals.json'), 'utf8')

describe('goals', () => {
  it('starts empty without creating a file, then persists titles, notes and deadlines', async () => {
    expect(await goalRepository.list()).toEqual([])
    expect(await vault.ls('data')).not.toContain('goals.json')
    const goal = await goalRepository.create({ ...input, title: `  ${input.title}  ` })
    expect(goal).toMatchObject({ ...input, status: 'active', completed_at: null })
    expect(JSON.parse(await contents())).toEqual([goal])
    expect(await goalRepository.list()).toEqual([goal])
  })

  it('orders the nearest deadlines first, including goals due in the past', async () => {
    const later = await goalRepository.create(input)
    const earlier = await goalRepository.create({ title: 'Earlier', deadline: '2026-09-01' })
    expect((await goalRepository.list()).map((g) => g.id)).toEqual([earlier.id, later.id])
  })

  it('edits, completes, retains completion time on edits, and reopens a goal', async () => {
    const goal = await goalRepository.create(input)
    const completed = await goalRepository.update(goal.id, { status: 'completed', deadline: '2026-11-01' })
    expect(completed.completed_at).toBeTypeOf('number')
    const edited = await goalRepository.update(goal.id, { notes: '', title: '  Finished reading  ' })
    expect(edited).toMatchObject({ title: 'Finished reading', notes: '', status: 'completed', completed_at: completed.completed_at })
    const reopened = await goalRepository.update(goal.id, { status: 'active' })
    expect(reopened).toMatchObject({ completed_at: null, created_at: goal.created_at, deadline: '2026-11-01' })
  })

  it.each([
    { title: '' }, { title: '  ' }, { deadline: '' }, { deadline: '2026-02-29' },
    { deadline: '2026-04-31' }, { deadline: null }, { notes: 12 }, { status: 'done' },
  ])('rejects invalid input without changing existing data: %j', async (patch) => {
    const goal = await goalRepository.create(input)
    const before = await contents()
    await expect(goalRepository.update(goal.id, patch as UpdateGoalInput)).rejects.toThrow()
    await expect(goalRepository.create({ ...input, ...patch } as CreateGoalInput)).rejects.toThrow()
    expect(await contents()).toBe(before)
  })

  it('accepts leap day and ignores attempts to change identity or managed timestamps', async () => {
    const goal = await goalRepository.create({ title: 'Leap goal', deadline: '2028-02-29' })
    const updated = await goalRepository.update(goal.id, {
      title: 'Renamed', id: 'injected', created_at: 0, completed_at: 1,
    } as UpdateGoalInput)
    expect(updated).toMatchObject({ id: goal.id, created_at: goal.created_at, completed_at: null })
  })

  it('preserves simultaneous creates and edits to different fields', async () => {
    const goals = await Promise.all(Array.from({ length: 12 }, (_, i) => goalRepository.create({ ...input, title: `Goal ${i}` })))
    expect(await goalRepository.list()).toHaveLength(12)
    await Promise.all([
      goalRepository.update(goals[0]!.id, { notes: 'New notes' }),
      goalRepository.update(goals[0]!.id, { deadline: '2027-01-01' }),
    ])
    expect((await goalRepository.list()).find((g) => g.id === goals[0]!.id)).toMatchObject({ notes: 'New notes', deadline: '2027-01-01' })
  })

  it.each(['not JSON', '{}', '[{"title":"Broken"}]'])('refuses to overwrite corrupt data: %s', async (raw) => {
    await vault.write('data/goals.json', raw)
    await expect(goalRepository.create(input)).rejects.toThrow()
    expect(await contents()).toBe(raw)
  })

  it('removes only the selected goal and rejects missing ids', async () => {
    const goal = await goalRepository.create(input)
    const keep = await goalRepository.create({ ...input, title: 'Keep me' })
    await goalRepository.remove(goal.id)
    expect(await goalRepository.list()).toEqual([keep])
    await expect(goalRepository.remove(goal.id)).rejects.toThrow(/No goal/)
    await expect(goalRepository.update(goal.id, { notes: 'x' })).rejects.toThrow(/No goal/)
  })

  it('finds completed goals by title or notes and routes them to Goals', async () => {
    const goal = await goalRepository.create(input)
    await goalRepository.update(goal.id, { status: 'completed' })
    for (const q of ['RL textbook', 'exercises']) {
      const hits = await searchRepository.query(q)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({ kind: 'goal', id: goal.id, state: 'completed', date: input.deadline })
      expect(primaryAction(hits[0]!)).toMatchObject({ type: 'navigate', route: 'goals' })
    }
  })
})

describe('goal deadlines', () => {
  it('counts whole calendar days through both DST transitions', () => {
    expect(goalDaysRemaining('2026-03-09', '2026-03-07')).toBe(2)
    expect(goalDaysRemaining('2026-11-02', '2026-10-31')).toBe(2)
    expect(goalDaysRemaining('2027-01-01', '2026-12-31')).toBe(1)
  })

  it('distinguishes due today, tomorrow, past deadlines, and completed goals', () => {
    const goal = { deadline: '2026-09-23', status: 'active' as const }
    expect(goalDeadlineLabel(goal, '2026-09-23')).toBe('Due today')
    expect(goalDeadlineLabel(goal, '2026-09-22')).toBe('Due tomorrow')
    expect(goalDeadlineLabel(goal, '2026-09-20')).toBe('3 days remaining')
    expect(goalDeadlineLabel(goal, '2026-09-24')).toBe('1 day past deadline')
    expect(goalDeadlineLabel({ ...goal, status: 'completed' }, '2026-09-25')).toBe('Completed')
  })
})
