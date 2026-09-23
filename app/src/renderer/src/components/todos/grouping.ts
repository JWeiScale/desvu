import { overlapsDay, scheduledWindow } from '@shared/scheduling'
import type { Category, DateString, Priority, Todo } from '@shared/types'

import { CATEGORY_ORDER } from '@/lib/category'

/**
 * Grouping, ordering and the meta strings for the list. Pure, so
 * `test/today-grouping.test.ts` can pin the ordering rules down without a DOM.
 */

export interface TodoGroup {
  category: Category
  todos: Todo[]
}

/** Done and dropped sink to the bottom of their group; live work stays at the top. */
function statusRank(todo: Todo): number {
  if (todo.status === 'done') return 1
  if (todo.status === 'dropped') return 2
  return 0
}

/**
 * Priority first — it is ordered data, and order carries the ranking at zero pixel cost,
 * which is why there is no p2/p3 label anywhere in this UI. Bigger tasks before smaller
 * ones at equal priority, because the big one is the one that has to be decided about.
 */
export function sortWithinGroup(todos: readonly Todo[], fallbackEstimate: number): Todo[] {
  return [...todos].sort((a, b) => {
    const status = statusRank(a) - statusRank(b)
    if (status !== 0) return status
    if (a.priority !== b.priority) return a.priority - b.priority
    const aEstimate = a.estimate_minutes ?? fallbackEstimate
    const bEstimate = b.estimate_minutes ?? fallbackEstimate
    if (aEstimate !== bEstimate) return bEstimate - aEstimate
    return a.created_at - b.created_at
  })
}

/**
 * Grouped by category in the comp's order, sorted by priority within each group. Empty
 * groups are dropped — an empty heading reads as something missing, and nothing here is
 * missing.
 */
export function groupByCategory(todos: readonly Todo[], fallbackEstimate: number): TodoGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    todos: sortWithinGroup(
      todos.filter((todo) => todo.category === category),
      fallbackEstimate
    ),
  })).filter((group) => group.todos.length > 0)
}

/**
 * Today's list, from `todos.list()`.
 *
 * `todos.forDate()` returns only open and doing work, which is right for the rail and for
 * `dayLoad` — but it means a task disappears the instant it is ticked, taking the reward
 * with it and leaving nowhere to hang the "how long did that take?" offer. The comp shows
 * the day as `4 open · 2 done`, so the list is built from everything due on or before the
 * day, plus whatever was *finished* on it.
 *
 * Dropped tasks are not here. They are still in the vault and still in search (PRD S3);
 * they are simply not today's problem any more.
 */
export function todaysList(todos: readonly Todo[], today: DateString): Todo[] {
  return todos.filter((todo) => {
    if (todo.due === null || todo.due > today) return false
    if (todo.status === 'open' || todo.status === 'doing') {
      return !scheduledWindow(todo) || overlapsDay(todo.scheduled_start!, todo.scheduled_end!, today)
    }
    if (todo.status !== 'done') return false
    if (todo.completed_at === null) return false
    const completed = new Date(todo.completed_at)
    const year = completed.getFullYear()
    const month = String(completed.getMonth() + 1).padStart(2, '0')
    const day = String(completed.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}` === today
  })
}

// ---------------------------------------------------------------------------
// row meta
// ---------------------------------------------------------------------------

export function estimateOf(todo: Todo, fallbackEstimate: number): number {
  return todo.estimate_minutes ?? fallbackEstimate
}

/** Whole days late. 0 when due today or undated. */
export function daysOverdue(todo: Todo, today: DateString): number {
  if (todo.due === null || todo.due >= today) return 0
  const due = Date.parse(`${todo.due}T00:00:00`)
  const now = Date.parse(`${today}T00:00:00`)
  if (Number.isNaN(due) || Number.isNaN(now)) return 0
  return Math.round((now - due) / 86_400_000)
}

/**
 * PRD T7 — overdue is unmissable without being punitive. `2 days late`, never a red
 * badge and never an exclamation mark. Gold at most; being late is information.
 */
export function overdueLabel(todo: Todo, today: DateString): string | null {
  const days = daysOverdue(todo, today)
  if (days <= 0) return null
  return days === 1 ? '1 day late' : `${days} days late`
}

/**
 * The right-hand meta on a row, exactly as the comp computes it:
 *
 *   done   `30m → 45m`   the estimate and what it actually took
 *   p0/p1  `p1 · 15m`    the priority prefix that keeps `PriorityEdge` from being
 *                        the only signal
 *   p2/p3  `15m`         deliberately unlabelled — unmarked means normal
 */
export function rowMeta(todo: Todo, fallbackEstimate: number): string {
  const estimate = estimateOf(todo, fallbackEstimate)
  if (todo.status === 'done') {
    return todo.actual_minutes === null
      ? `${estimate}m`
      : `${estimate}m → ${todo.actual_minutes}m`
  }
  return todo.priority <= 1 ? `p${todo.priority} · ${estimate}m` : `${estimate}m`
}

/** `4 open · 2 done`, the card's meta line. Dropped todos are not counted as either. */
export function openCountLabel(todos: readonly Todo[]): string {
  const open = todos.filter((todo) => todo.status === 'open' || todo.status === 'doing').length
  const done = todos.filter((todo) => todo.status === 'done').length
  return `${open} open · ${done} done`
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  0: 'p0 · drop everything',
  1: 'p1 · high',
  2: 'p2 · normal',
  3: 'p3 · someday',
}

/**
 * The options offered after a completion (PRD T11). Centred on the estimate, rounded to
 * five minutes, deduplicated and never zero — four taps that cover the realistic range
 * without asking anyone to think about a number field.
 */
export function actualOptions(estimate: number): number[] {
  const round5 = (value: number): number => Math.max(5, Math.round(value / 5) * 5)
  const candidates = [round5(estimate / 2), round5(estimate), round5(estimate * 1.5), round5(estimate * 2)]
  return [...new Set(candidates)].sort((a, b) => a - b)
}
