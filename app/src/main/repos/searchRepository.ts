import path from 'node:path'
import type { SearchHit } from '@shared/types'
import { VAULT_SUBDIRS, vaultPath } from '@shared/vault'
import { readTextFileOrNull } from '../lib/atomic'
import { listDirectory } from '../lib/paths'
import { brainDumpRepository } from './brainDumpRepository'
import { journalRepository } from './journalRepository'
import { libraryRepository } from './libraryRepository'
import { mealRepository } from './mealRepository'
import { todoRepository } from './todoRepository'
import { workoutRepository } from './workoutRepository'

/**
 * Search is **recall**, and recall is where PKM tools usually fail (PRD S1–S3).
 *
 * The rule that matters: nothing is hidden from this. Archived library items, completed
 * and dropped todos, and recurrence templates are all excluded from their default views
 * and all reachable here. A record you cannot find is a record you did not keep.
 *
 * `synthesis.journal_access` is deliberately *not* applied — that setting governs what a
 * cloud model may read (J8), not what the user may find in their own vault on their own
 * machine.
 */
const MAX_HITS = 200
const SNIPPET_RADIUS = 70

function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}

function snippetAround(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''

  const lower = flat.toLowerCase()
  let index = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found !== -1 && (index === -1 || found < index)) index = found
  }
  if (index === -1) return flat.slice(0, SNIPPET_RADIUS * 2).trim()

  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(flat.length, index + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

/** Every term must appear somewhere; a title match outranks a body match. */
function score(terms: string[], title: string, body: string): number {
  const lowerTitle = title.toLowerCase()
  const lowerBody = body.toLowerCase()

  let total = 0
  for (const term of terms) {
    const inTitle = lowerTitle.includes(term)
    const inBody = lowerBody.includes(term)
    if (!inTitle && !inBody) return 0
    total += inTitle ? 3 : 0
    total += inBody ? 1 : 0
  }
  return total
}

interface Candidate {
  hit: SearchHit
  haystack: string
  weight: number
}

async function synthesisCandidates(): Promise<Candidate[]> {
  const directory = vaultPath(VAULT_SUBDIRS.synthesis)
  const names = (await listDirectory(directory)).filter(
    (name) => name.endsWith('.md') && !name.startsWith('.')
  )

  const candidates: Candidate[] = []
  for (const name of names) {
    const raw = await readTextFileOrNull(path.join(directory, name))
    if (raw === null) continue
    const title = path.basename(name, '.md')
    candidates.push({
      hit: {
        kind: 'synthesis',
        id: `${VAULT_SUBDIRS.synthesis}/${name}`,
        title,
        snippet: '',
        // Synthesis notes are named by ISO week (`2026-W31`), which is not a day.
        date: null,
        path: `${VAULT_SUBDIRS.synthesis}/${name}`,
      },
      haystack: raw,
      weight: 1,
    })
  }
  return candidates
}

async function collectCandidates(): Promise<Candidate[]> {
  const [todos, entries, library, threads, meals, workouts, synthesis] =
    await Promise.all([
      todoRepository.listAll(),
      journalRepository.list(),
      libraryRepository.listAll(),
      brainDumpRepository.listThreads(),
      mealRepository.listAll(),
      workoutRepository.listAll(),
      synthesisCandidates(),
    ])

  const candidates: Candidate[] = []

  for (const todo of todos) {
    candidates.push({
      hit: {
        kind: 'todo',
        id: todo.id,
        title: todo.text,
        snippet: '',
        date: todo.due,
        state: todo.status,
      },
      haystack: [todo.text, todo.notes, todo.tags.join(' '), todo.category, todo.status].join(' '),
      weight: 1.2,
    })
  }

  for (const entry of entries) {
    candidates.push({
      hit: {
        kind: 'journal',
        id: entry.id,
        title: `Journal · ${entry.entry_date}`,
        snippet: '',
        date: entry.entry_date,
      },
      haystack: [
        entry.gratitude_text ?? '',
        entry.learned ?? '',
        entry.mood_word ?? '',
        entry.mood_context ?? '',
      ].join(' '),
      weight: 1,
    })
  }

  for (const item of library) {
    candidates.push({
      hit: {
        kind: 'library',
        id: item.path,
        title: item.title,
        snippet: '',
        date: item.saved,
        path: item.path,
      },
      haystack: [item.title, item.body, item.tags.join(' '), item.source ?? '', item.url ?? ''].join(
        ' '
      ),
      weight: 1.1,
    })
  }

  for (const thread of threads) {
    candidates.push({
      hit: {
        kind: 'brain-dump',
        id: thread.path,
        title: thread.title,
        snippet: '',
        date: thread.updated,
        path: thread.path,
      },
      haystack: [thread.title, thread.topic, thread.body, thread.tags.join(' ')].join(' '),
      weight: 1.1,
    })
  }

  for (const meal of meals) {
    candidates.push({
      hit: {
        kind: 'meal',
        id: meal.id,
        title: meal.description || meal.meal,
        snippet: '',
        date: meal.date,
      },
      haystack: [meal.description, meal.meal].join(' '),
      weight: 0.8,
    })
  }

  for (const workout of workouts) {
    candidates.push({
      hit: {
        kind: 'workout',
        id: workout.id,
        title: workout.description || workout.type,
        snippet: '',
        date: workout.date,
      },
      haystack: [workout.description, workout.type].join(' '),
      weight: 0.8,
    })
  }

  candidates.push(...synthesis)
  return candidates
}

export const searchRepository = {
  async query(rawQuery: string): Promise<SearchHit[]> {
    const terms = normalizeQuery(typeof rawQuery === 'string' ? rawQuery : '')
    if (terms.length === 0) return []

    const candidates = await collectCandidates()
    const scored: { hit: SearchHit; rank: number }[] = []

    for (const candidate of candidates) {
      const rank = score(terms, candidate.hit.title, candidate.haystack)
      if (rank === 0) continue
      scored.push({
        hit: {
          ...candidate.hit,
          snippet: snippetAround(
            candidate.haystack.trim() === '' ? candidate.hit.title : candidate.haystack,
            terms
          ),
        },
        rank: rank * candidate.weight,
      })
    }

    return scored
      .sort((a, b) => b.rank - a.rank || (b.hit.date ?? '').localeCompare(a.hit.date ?? ''))
      .slice(0, MAX_HITS)
      .map((entry) => entry.hit)
  },
}

export type SearchRepository = typeof searchRepository
