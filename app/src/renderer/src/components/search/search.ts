import type { DateString, SearchHit } from '@shared/types'

import { ROUTES, type RouteId } from '@/lib/routes'

/**
 * Search's pure logic — grouping, filtering, highlighting and the "where does Enter take
 * me" decision. No React and no `bridge()`, so `test/search-ui-*.test.ts` can run it
 * under the node test environment.
 *
 * The rule this file exists to hold: **nothing is filtered back out.** The repository
 * deliberately reaches archived library items, completed and dropped todos and recurrence
 * templates (PRD S3), and it would be trivial for a UI to quietly undo that by hiding
 * what the default views hide. There is no status filter anywhere in this file, and there
 * must never be one. A record you cannot find is a record you did not keep.
 */

export type SearchKind = SearchHit['kind']

/** Chip order. Deliberately stable, so the filter row does not reshuffle as you type. */
export const SEARCH_KINDS: readonly SearchKind[] = [
  'todo',
  'goal',
  'journal',
  'library',
  'brain-dump',
  'synthesis',
  'meal',
  'workout',
] as const

export const KIND_LABEL: Record<SearchKind, string> = {
  todo: 'To-dos',
  goal: 'Goals',
  journal: 'Journal',
  library: 'Library',
  'brain-dump': 'Brain dump',
  synthesis: 'Synthesis',
  meal: 'Meals',
  workout: 'Training',
}

/** Where a hit of this kind lives, for the "go to" action. */
export const KIND_ROUTE: Record<SearchKind, RouteId> = {
  todo: 'today',
  goal: 'goals',
  journal: 'journal',
  library: 'explore',
  'brain-dump': 'brain-dump',
  synthesis: 'synthesis',
  meal: 'meals',
  workout: 'meals',
}

export function hitKey(hit: SearchHit): string {
  return `${hit.kind}:${hit.id}`
}

// ---------------------------------------------------------------------------
// terms and highlighting
// ---------------------------------------------------------------------------

export function normalizeTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}

export interface Segment {
  text: string
  match: boolean
}

/**
 * Split a snippet into matched and unmatched runs so the match can be shown in context.
 * Case-insensitive, longest-match-wins at any given position, and it never reorders or
 * drops a character — concatenating the segments returns the input exactly.
 */
export function highlightSegments(text: string, terms: readonly string[]): Segment[] {
  const usable = terms.filter((term) => term.length > 0)
  if (text === '' || usable.length === 0) {
    return text === '' ? [] : [{ text, match: false }]
  }

  const lower = text.toLowerCase()
  const segments: Segment[] = []
  let plain = ''

  const flush = (): void => {
    if (plain !== '') {
      segments.push({ text: plain, match: false })
      plain = ''
    }
  }

  let index = 0
  while (index < text.length) {
    let longest = 0
    for (const term of usable) {
      if (term.length > longest && lower.startsWith(term, index)) longest = term.length
    }
    if (longest > 0) {
      flush()
      segments.push({ text: text.slice(index, index + longest), match: true })
      index += longest
    } else {
      plain += text[index]
      index += 1
    }
  }

  flush()
  return segments
}

// ---------------------------------------------------------------------------
// filtering (PRD S2 — by type and by date, and by nothing else)
// ---------------------------------------------------------------------------

export type DateWindow = 'all' | '7d' | '30d' | '365d'

export const DATE_WINDOW_LABEL: Record<DateWindow, string> = {
  all: 'Any time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '365d': 'Last year',
}

export const DATE_WINDOW_DAYS: Record<DateWindow, number | null> = {
  all: null,
  '7d': 7,
  '30d': 30,
  '365d': 365,
}

export const ALL_KINDS = 'all' as const

export interface SearchFilters {
  kind: SearchKind | typeof ALL_KINDS
  window: DateWindow
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = { kind: ALL_KINDS, window: 'all' }

/** `YYYY-MM-DD` shifted by whole days, in local time. */
export function shiftDays(date: DateString, days: number): DateString {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const [, year, month, day] = match
  const shifted = new Date(Number(year), Number(month) - 1, Number(day) + days)
  const mm = String(shifted.getMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getDate()).padStart(2, '0')
  return `${shifted.getFullYear()}-${mm}-${dd}`
}

/**
 * Kind and date only.
 *
 * Undated hits — a synthesis note is named by ISO week, which is not a day — stay visible
 * in every window. We cannot prove they fall outside it, and guessing in the direction of
 * hiding things is the one mistake this feature cannot afford.
 */
export function applySearchFilters(
  hits: readonly SearchHit[],
  filters: SearchFilters,
  today: DateString
): SearchHit[] {
  const days = DATE_WINDOW_DAYS[filters.window]
  const cutoff = days === null ? null : shiftDays(today, -days)

  return hits.filter((hit) => {
    if (filters.kind !== ALL_KINDS && hit.kind !== filters.kind) return false
    if (cutoff === null || hit.date === null || hit.date === undefined) return true
    return hit.date >= cutoff
  })
}

export interface KindCount {
  kind: SearchKind
  count: number
}

/** Counts for the chips, in `SEARCH_KINDS` order, kinds with no hits omitted. */
export function kindCounts(hits: readonly SearchHit[]): KindCount[] {
  const counts = new Map<SearchKind, number>()
  for (const hit of hits) counts.set(hit.kind, (counts.get(hit.kind) ?? 0) + 1)
  return SEARCH_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind) ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

/**
 * The repository builds each snippet out of a haystack that begins with the record's own
 * title, so a match near the start produces a snippet that simply restates the row above
 * it. Strip that prefix and keep whatever context follows; return null when nothing
 * meaningful is left, so the row shows the title once rather than twice.
 */
export function snippetContext(title: string, snippet: string): string | null {
  const flat = snippet.replace(/\s+/g, ' ').trim()
  if (flat === '') return null

  const flatTitle = title.replace(/\s+/g, ' ').trim()
  const rest = flat.toLowerCase().startsWith(flatTitle.toLowerCase())
    ? flat.slice(flatTitle.length).replace(/^[\s·—–-]+/, '')
    : flat

  if (rest === '' || rest === '…') return null
  if (rest.toLowerCase() === flatTitle.toLowerCase()) return null
  return rest
}

export interface SearchGroup {
  kind: SearchKind
  label: string
  hits: SearchHit[]
}

/**
 * Group by kind, in the order the groups first appear in the ranked list, and keep the
 * repository's ranking inside each group. Relevance order is what makes "type, arrow,
 * enter" work: the first row is the best hit, and it is selected already.
 */
export function groupHits(hits: readonly SearchHit[]): SearchGroup[] {
  const groups: SearchGroup[] = []
  const byKind = new Map<SearchKind, SearchGroup>()

  for (const hit of hits) {
    let group = byKind.get(hit.kind)
    if (!group) {
      group = { kind: hit.kind, label: KIND_LABEL[hit.kind], hits: [] }
      byKind.set(hit.kind, group)
      groups.push(group)
    }
    group.hits.push(hit)
  }

  return groups
}

/** The grouped list read top to bottom — what the arrow keys walk. */
export function flattenGroups(groups: readonly SearchGroup[]): SearchHit[] {
  return groups.flatMap((group) => group.hits)
}

// ---------------------------------------------------------------------------
// what Enter does
// ---------------------------------------------------------------------------

export type SearchAction =
  | { type: 'obsidian'; path: string; label: string }
  | { type: 'navigate'; route: RouteId; label: string }

/**
 * Markdown-backed hits carry a vault-relative path, and for those the record *is* the
 * file — so Enter hands it to Obsidian, where it can be read, edited and followed into
 * the graph. Everything else lives in a JSON tracker and Enter goes to the surface that
 * renders it.
 *
 * The row always states which one it will do, so it is never a surprise.
 */
export function primaryAction(hit: SearchHit): SearchAction {
  if (hit.path) return { type: 'obsidian', path: hit.path, label: 'Open in Obsidian' }
  const route = KIND_ROUTE[hit.kind]
  return { type: 'navigate', route, label: `Go to ${ROUTES[route].label}` }
}

/** The other one, on ⌘↵ — only meaningful when the primary was Obsidian. */
export function secondaryAction(hit: SearchHit): SearchAction | null {
  if (!hit.path) return null
  const route = KIND_ROUTE[hit.kind]
  return { type: 'navigate', route, label: `Go to ${ROUTES[route].label}` }
}
