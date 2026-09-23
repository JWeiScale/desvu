import { describe, expect, it } from 'vitest'
import type { SearchHit } from '../src/shared/types'
import {
  ALL_KINDS,
  DEFAULT_SEARCH_FILTERS,
  SEARCH_KINDS,
  applySearchFilters,
  flattenGroups,
  groupHits,
  highlightSegments,
  hitKey,
  kindCounts,
  normalizeTerms,
  primaryAction,
  secondaryAction,
  shiftDays,
  snippetContext,
  type SearchFilters,
} from '../src/renderer/src/components/search/search'

/**
 * The overlay's presentation rules.
 *
 * The one that matters most is negative: there is no status filter in this pipeline and
 * there must never be one. The repository deliberately reaches archived library items and
 * completed todos (PRD S3); a UI that filtered them back out would undo the requirement
 * while looking correct. `search-ui-recall.test.ts` proves the end-to-end case.
 */

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    kind: 'todo',
    id: 'id-1',
    title: 'a title',
    snippet: 'a snippet',
    date: '2026-08-01',
    ...overrides,
  }
}

const filters = (patch: Partial<SearchFilters> = {}): SearchFilters => ({
  ...DEFAULT_SEARCH_FILTERS,
  ...patch,
})

describe('terms', () => {
  it('splits, lowercases and drops empties', () => {
    expect(normalizeTerms('  Malloc   LAB ')).toEqual(['malloc', 'lab'])
    expect(normalizeTerms('   ')).toEqual([])
  })
})

describe('highlighting the match in context', () => {
  it('marks every occurrence, case-insensitively', () => {
    const segments = highlightSegments('Malloc lab and more malloc', ['malloc'])
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text)).toEqual([
      'Malloc',
      'malloc',
    ])
  })

  it('never loses or reorders a character', () => {
    const text = '…the malloc lab is mostly reading…'
    const rebuilt = highlightSegments(text, ['malloc', 'lab'])
      .map((segment) => segment.text)
      .join('')
    expect(rebuilt).toBe(text)
  })

  it('prefers the longest term at a position', () => {
    const segments = highlightSegments('allocator', ['alloc', 'allocator'])
    expect(segments).toEqual([{ text: 'allocator', match: true }])
  })

  it('handles no terms and an empty string', () => {
    expect(highlightSegments('plain', [])).toEqual([{ text: 'plain', match: false }])
    expect(highlightSegments('', ['x'])).toEqual([])
  })

  it('drops a snippet that only restates the title, and keeps the context after it', () => {
    // The repository's haystack starts with the record's own title, so a match near the
    // start produces a snippet that repeats the row above it.
    expect(snippetContext('Email the professor', 'Email the professor')).toBeNull()
    expect(snippetContext('Email the professor', 'Email the professor school open')).toBe(
      'school open'
    )
    expect(snippetContext('A title', '…somewhere in the body…')).toBe('…somewhere in the body…')
    expect(snippetContext('A title', '')).toBeNull()
  })

  it('keeps non-BMP characters intact', () => {
    const text = '👩‍💻 malloc'
    const rebuilt = highlightSegments(text, ['malloc'])
      .map((segment) => segment.text)
      .join('')
    expect(rebuilt).toBe(text)
  })
})

describe('grouping', () => {
  const hits = [
    hit({ kind: 'library', id: 'l1' }),
    hit({ kind: 'todo', id: 't1' }),
    hit({ kind: 'library', id: 'l2' }),
    hit({ kind: 'journal', id: 'j1' }),
  ]

  it('groups by kind and keeps the repository ranking inside each group', () => {
    const groups = groupHits(hits)
    expect(groups.map((group) => group.kind)).toEqual(['library', 'todo', 'journal'])
    expect(groups[0]?.hits.map((entry) => entry.id)).toEqual(['l1', 'l2'])
  })

  it('orders groups by their best hit, so the first row is the best match', () => {
    const groups = groupHits(hits)
    expect(flattenGroups(groups)[0]?.id).toBe('l1')
  })

  it('flattens to exactly the input set, so arrow keys can reach every hit', () => {
    // Grouping reorders — that is its job — but it may never lose or duplicate a hit.
    const flat = flattenGroups(groupHits(hits))
    expect(flat).toHaveLength(hits.length)
    expect(new Set(flat.map(hitKey))).toEqual(new Set(hits.map(hitKey)))
  })

  it('counts kinds in a stable chip order regardless of rank', () => {
    expect(kindCounts(hits)).toEqual([
      { kind: 'todo', count: 1 },
      { kind: 'journal', count: 1 },
      { kind: 'library', count: 2 },
    ])
  })

  it('covers every kind the contract defines', () => {
    expect(new Set(SEARCH_KINDS)).toEqual(
      new Set(['todo', 'goal', 'journal', 'library', 'brain-dump', 'synthesis', 'meal', 'workout'])
    )
  })
})

describe('filters (S2) — type and date, and nothing else', () => {
  const hits = [
    hit({ kind: 'todo', id: 't', date: '2026-08-01' }),
    hit({ kind: 'library', id: 'l', date: '2026-01-05' }),
    hit({ kind: 'synthesis', id: 's', date: null, path: 'Synthesis/2026-W31.md' }),
  ]

  it('filters by kind', () => {
    expect(applySearchFilters(hits, filters({ kind: 'library' }), '2026-08-01').map((h) => h.id)).toEqual(
      ['l']
    )
  })

  it('filters by date window', () => {
    const recent = applySearchFilters(hits, filters({ window: '30d' }), '2026-08-01')
    expect(recent.map((h) => h.id)).toContain('t')
    expect(recent.map((h) => h.id)).not.toContain('l')
  })

  it('keeps undated hits in every window — we cannot prove they are outside it', () => {
    for (const window of ['all', '7d', '30d', '365d'] as const) {
      const kept = applySearchFilters(hits, filters({ window }), '2026-08-01')
      expect(kept.map((h) => h.id)).toContain('s')
    }
  })

  it('defaults to hiding nothing at all', () => {
    expect(applySearchFilters(hits, filters(), '2026-08-01')).toHaveLength(hits.length)
    expect(DEFAULT_SEARCH_FILTERS).toEqual({ kind: ALL_KINDS, window: 'all' })
  })

  it('shifts dates in local time across a month boundary', () => {
    expect(shiftDays('2026-08-01', -7)).toBe('2026-07-25')
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('what Enter does', () => {
  it('hands a markdown-backed hit to Obsidian — the record is the file', () => {
    const action = primaryAction(hit({ kind: 'library', path: 'Library/2026-08-01-ddia.md' }))
    expect(action).toEqual({
      type: 'obsidian',
      path: 'Library/2026-08-01-ddia.md',
      label: 'Open in Obsidian',
    })
  })

  it('navigates to the surface that renders a JSON-backed record', () => {
    expect(primaryAction(hit({ kind: 'todo' }))).toMatchObject({ type: 'navigate', route: 'today' })
    expect(primaryAction(hit({ kind: 'workout' }))).toMatchObject({
      type: 'navigate',
      route: 'meals',
    })
  })

  it('offers the surface as the secondary action only when the primary was Obsidian', () => {
    expect(secondaryAction(hit({ kind: 'library', path: 'Library/x.md' }))).toMatchObject({
      type: 'navigate',
      route: 'explore',
    })
    expect(secondaryAction(hit({ kind: 'todo' }))).toBeNull()
  })

  it('routes every kind somewhere real', () => {
    for (const kind of SEARCH_KINDS) {
      expect(primaryAction(hit({ kind }))).toBeTruthy()
    }
  })
})
