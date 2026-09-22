import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { brainDumpRepository } from '../src/main/repos/brainDumpRepository'
import { financeRepository } from '../src/main/repos/financeRepository'
import { journalRepository } from '../src/main/repos/journalRepository'
import { libraryRepository } from '../src/main/repos/libraryRepository'
import { mealRepository } from '../src/main/repos/mealRepository'
import { searchRepository } from '../src/main/repos/searchRepository'
import { settingsRepository } from '../src/main/repos/settingsRepository'
import { todoRepository } from '../src/main/repos/todoRepository'
import { workoutRepository } from '../src/main/repos/workoutRepository'
import { createTempVault, dayOffset, type TempVault } from './helpers/vault'

let vault: TempVault

beforeEach(async () => {
  vault = await createTempVault('search')
})

afterEach(async () => {
  await vault.dispose()
})

describe('search reaches every surface (S1)', () => {
  it('leaves legacy finance records intact but excludes them from search', async () => {
    const purchase = await financeRepository.create({
      date: dayOffset(0), amount: 4, category: 'coffee',
      description: 'legacy expense', source: 'app',
    })
    await expect(searchRepository.query('legacy expense')).resolves.toEqual([])
    expect((await financeRepository.listAll()).map((record) => record.id)).toContain(purchase.id)
  })

  it('finds hits of each kind from one query', async () => {
    await todoRepository.create({ text: 'malloc lab writeup', category: 'school' })
    await journalRepository.upsert({
      entry_date: dayOffset(0),
      rating: 4,
      learned: 'the malloc lab is mostly reading, not writing',
    })
    await libraryRepository.create({ title: 'malloc internals', body: 'a summary' })
    await brainDumpRepository.createThread('School', 'Allocators', 'thinking about malloc again')
    await mealRepository.create({
      date: dayOffset(0),
      meal: 'lunch',
      description: 'malloc-fuelled burrito',
      calories: null,
      protein_g: null,
      estimated: false,
      source: 'app',
    })
    await workoutRepository.create({
      date: dayOffset(0),
      type: 'run',
      description: 'ran to clear my head about malloc',
      duration_minutes: 30,
      source: 'app',
    })
    await financeRepository.create({
      date: dayOffset(0),
      amount: 4,
      category: 'coffee',
      description: 'coffee for the malloc lab',
      source: 'app',
    })
    await vault.write('Synthesis/2026-W31.md', '# Week 31\nYou spent the week on malloc.\n')

    const hits = await searchRepository.query('malloc')
    const kinds = new Set(hits.map((hit) => hit.kind))

    expect(kinds).toEqual(
      new Set(['todo', 'journal', 'library', 'brain-dump', 'meal', 'workout', 'synthesis'])
    )
    expect(hits.every((hit) => hit.snippet.length > 0)).toBe(true)
  })

  it('carries a vault path for markdown-backed hits so Obsidian can be opened at them', async () => {
    const item = await libraryRepository.create({ title: 'replication strategies' })
    const [hit] = await searchRepository.query('replication')
    expect(hit?.path).toBe(item.path)
  })

  it('requires every term and returns nothing for a blank query', async () => {
    await todoRepository.create({ text: 'buy oat milk' })
    await expect(searchRepository.query('oat milk')).resolves.toHaveLength(1)
    await expect(searchRepository.query('oat espresso')).resolves.toEqual([])
    await expect(searchRepository.query('   ')).resolves.toEqual([])
  })

  it('ranks a title match above a body-only match', async () => {
    await libraryRepository.create({ title: 'Raft consensus', body: 'about distributed logs' })
    await libraryRepository.create({ title: 'Something else', body: 'mentions raft once' })

    const hits = await searchRepository.query('raft')
    expect(hits[0]?.title).toBe('Raft consensus')
  })
})

describe('search reaches what the default views hide (S3)', () => {
  it('finds an archived library item', async () => {
    const item = await libraryRepository.create({ title: 'quicksort revisited' })
    await libraryRepository.setArchived(item.path, true)

    await expect(libraryRepository.list()).resolves.toEqual([])
    const hits = await searchRepository.query('quicksort')
    expect(hits.map((hit) => hit.id)).toContain(item.path)
  })

  it('finds a completed todo', async () => {
    const todo = await todoRepository.create({ text: 'submit the Ramp OA', category: 'recruiting' })
    await todoRepository.complete(todo.id, 45)

    const hits = await searchRepository.query('Ramp OA')
    expect(hits.map((hit) => hit.id)).toContain(todo.id)
  })

  it('finds a dropped todo', async () => {
    const todo = await todoRepository.create({ text: 'learn the accordion' })
    await todoRepository.update(todo.id, { status: 'dropped' })

    const hits = await searchRepository.query('accordion')
    expect(hits.map((hit) => hit.id)).toContain(todo.id)
  })

  it('finds a recurrence template even though it appears in no list', async () => {
    const template = await todoRepository.create({
      text: 'stretch before climbing',
      recurrence: { type: 'daily', interval: 1 },
    })

    expect((await todoRepository.list()).map((todo) => todo.id)).not.toContain(template.id)
    const hits = await searchRepository.query('stretch climbing')
    expect(hits.map((hit) => hit.id)).toContain(template.id)
  })

  it('still finds journal prose when journal_access is set to metadata', async () => {
    // J8 governs what a cloud agent may read, not what the user may find in their own
    // vault on their own machine.
    await journalRepository.upsert({
      entry_date: dayOffset(0),
      rating: 3,
      gratitude_text: 'the walk along the Monongahela',
    })
    await settingsRepository.update({ synthesis: { journal_access: 'metadata' } })

    const hits = await searchRepository.query('Monongahela')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('journal')
  })
})
