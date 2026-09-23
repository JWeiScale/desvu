import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchHit } from '../src/shared/types'
import { brainDumpRepository } from '../src/main/repos/brainDumpRepository'
import { financeRepository } from '../src/main/repos/financeRepository'
import { goalRepository } from '../src/main/repos/goalRepository'
import { journalRepository } from '../src/main/repos/journalRepository'
import { libraryRepository } from '../src/main/repos/libraryRepository'
import { mealRepository } from '../src/main/repos/mealRepository'
import { searchRepository } from '../src/main/repos/searchRepository'
import { todoRepository } from '../src/main/repos/todoRepository'
import { workoutRepository } from '../src/main/repos/workoutRepository'
import {
  DEFAULT_SEARCH_FILTERS,
  SEARCH_KINDS,
  applySearchFilters,
  flattenGroups,
  groupHits,
  kindCounts,
  normalizeTerms,
  highlightSegments,
} from '../src/renderer/src/components/search/search'
import { createTempVault, dayOffset, type TempVault } from './helpers/vault'

/**
 * The requirement, end to end: **a record the default views hide is still findable.**
 *
 * The repository already reaches archived library items and completed todos (PRD S3), so
 * the failure mode this file exists to catch is a UI that quietly filters them back out.
 * Every assertion runs the real repository result through the exact pipeline the overlay
 * uses — `applySearchFilters` → `groupHits` → `flattenGroups` — and checks what survives.
 */

let vault: TempVault

beforeEach(async () => {
  vault = await createTempVault('search-ui')
})

afterEach(async () => {
  await vault.dispose()
})

const TODAY = dayOffset(0)

/** Exactly what the overlay renders, from a raw repository result. */
function throughTheUi(hits: SearchHit[], filters = DEFAULT_SEARCH_FILTERS): SearchHit[] {
  return flattenGroups(groupHits(applySearchFilters(hits, filters, TODAY)))
}

async function seedEveryKind(): Promise<void> {
  await goalRepository.create({ title: 'quenelle goal', deadline: TODAY })
  // A todo that is finished — excluded from every list the app renders.
  const done = await todoRepository.create({ text: 'ship the quenelle writeup', category: 'school' })
  await todoRepository.complete(done.id, 45)

  // A todo that was dropped — likewise invisible everywhere else.
  const dropped = await todoRepository.create({ text: 'quenelle side quest', category: 'personal' })
  await todoRepository.update(dropped.id, { status: 'dropped' })

  // An open one due today, so the "completed is excluded from Today" assertion is not
  // vacuous. (`forDate` also excludes undated todos, hence the explicit due date.)
  await todoRepository.create({ text: 'quenelle open task', category: 'school', due: TODAY })

  // A library item that has stepped out of the queue.
  const item = await libraryRepository.create({
    title: 'Quenelle notes on allocators',
    url: 'https://example.com/quenelle',
    body: 'A summary mentioning quenelle exactly once.',
  })
  await libraryRepository.setArchived(item.path, true)

  // And one still in it.
  await libraryRepository.create({ title: 'Quenelle live item', body: 'still in the queue' })

  await journalRepository.upsert({
    entry_date: TODAY,
    rating: 5,
    learned: 'the word quenelle came up twice today',
  })
  await brainDumpRepository.createThread('School', 'Allocators', 'thinking about quenelle again')
  await mealRepository.create({
    date: TODAY,
    meal: 'lunch',
    description: 'quenelle and potatoes',
    calories: null,
    protein_g: null,
    estimated: false,
    source: 'app',
  })
  await workoutRepository.create({
    date: TODAY,
    type: 'run',
    description: 'ran while thinking about quenelle',
    duration_minutes: 30,
    source: 'app',
  })
  await financeRepository.create({
    date: TODAY,
    amount: 12,
    category: 'food',
    description: 'quenelle for lunch',
    source: 'app',
  })
  await vault.write('Synthesis/2026-W31.md', '# Week 31\nThe week of the quenelle.\n')
}

describe('nothing is hidden from recall (S3)', () => {
  it('an ARCHIVED library item still appears in search, through the UI pipeline', async () => {
    await seedEveryKind()

    const queue = await libraryRepository.list()
    expect(queue.map((entry) => entry.title)).not.toContain('Quenelle notes on allocators')

    const shown = throughTheUi(await searchRepository.query('quenelle'))
    const libraryHits = shown.filter((entry) => entry.kind === 'library').map((entry) => entry.title)
    expect(libraryHits).toContain('Quenelle notes on allocators')
    expect(libraryHits).toContain('Quenelle live item')
  })

  it('a COMPLETED todo still appears in search, through the UI pipeline', async () => {
    await seedEveryKind()

    // The default view — Today — has no notion of a finished task.
    const today = await todoRepository.forDate(TODAY)
    expect(today.map((entry) => entry.text)).not.toContain('ship the quenelle writeup')
    expect(today.map((entry) => entry.text)).toContain('quenelle open task')

    const shown = throughTheUi(await searchRepository.query('quenelle'))
    expect(shown.map((entry) => entry.title)).toContain('ship the quenelle writeup')
  })

  it('a dropped todo survives the pipeline too', async () => {
    await seedEveryKind()
    const shown = throughTheUi(await searchRepository.query('quenelle'))
    expect(shown.map((entry) => entry.title)).toContain('quenelle side quest')
  })

  it('the kind filter narrows to library without re-hiding the archived one', async () => {
    await seedEveryKind()
    const hits = await searchRepository.query('quenelle')

    const shown = throughTheUi(hits, { ...DEFAULT_SEARCH_FILTERS, kind: 'library' })
    expect(shown.every((entry) => entry.kind === 'library')).toBe(true)
    expect(shown.map((entry) => entry.title)).toContain('Quenelle notes on allocators')
  })

  it('the date filter does not drop them either', async () => {
    await seedEveryKind()
    const hits = await searchRepository.query('quenelle')

    const shown = throughTheUi(hits, { ...DEFAULT_SEARCH_FILTERS, window: '30d' })
    const titles = shown.map((entry) => entry.title)
    expect(titles).toContain('Quenelle notes on allocators')
    expect(titles).toContain('ship the quenelle writeup')
  })

  it('the UI pipeline drops nothing at all under the default filters', async () => {
    await seedEveryKind()
    const hits = await searchRepository.query('quenelle')
    expect(throughTheUi(hits)).toHaveLength(hits.length)
  })
})

describe('coverage — every kind is reachable from one input (S1)', () => {
  it('renders a group for all eight kinds', async () => {
    await seedEveryKind()

    const groups = groupHits(applySearchFilters(await searchRepository.query('quenelle'), DEFAULT_SEARCH_FILTERS, TODAY))
    expect(new Set(groups.map((group) => group.kind))).toEqual(new Set(SEARCH_KINDS))
    expect(groups.every((group) => group.hits.length > 0)).toBe(true)
  })

  it('gives every chip a count and every hit a place in the arrow-key order', async () => {
    await seedEveryKind()
    const hits = await searchRepository.query('quenelle')

    const counts = kindCounts(hits)
    expect(counts.reduce((total, entry) => total + entry.count, 0)).toBe(hits.length)
    expect(flattenGroups(groupHits(hits))).toHaveLength(hits.length)
  })

  it('markdown-backed hits carry a path so Obsidian can be opened at them (E5)', async () => {
    await seedEveryKind()
    const hits = await searchRepository.query('quenelle')

    for (const kind of ['library', 'brain-dump', 'synthesis'] as const) {
      const hit = hits.find((entry) => entry.kind === kind)
      expect(hit?.path, `${kind} should carry a vault-relative path`).toBeTruthy()
      expect(hit?.path?.startsWith('/')).toBe(false)
    }
  })

  it('every hit has something to show in context', async () => {
    await seedEveryKind()
    const terms = normalizeTerms('quenelle')

    for (const hit of await searchRepository.query('quenelle')) {
      const text = hit.snippet === '' ? hit.title : hit.snippet
      const segments = highlightSegments(text, terms)
      expect(segments.map((segment) => segment.text).join('')).toBe(text)
    }
  })
})
