import { describe, expect, it } from 'vitest'
import type { Todo } from '@shared/types'

import {
  actualOptions,
  groupByCategory,
  openCountLabel,
  overdueLabel,
  rowMeta,
  sortWithinGroup,
  todaysList,
} from '@/components/todos/grouping'

const TODAY = '2026-08-01'

let sequence = 0
function todo(overrides: Partial<Todo> = {}): Todo {
  sequence += 1
  return {
    id: `todo-${sequence}`,
    text: `Task ${sequence}`,
    category: 'school',
    priority: 2,
    estimate_minutes: 30,
    actual_minutes: null,
    due: TODAY,
    status: 'open',
    recurrence: null,
    recurrence_parent: null,
    tags: [],
    notes: '',
    source: 'app',
    created_at: sequence,
    updated_at: sequence,
    completed_at: null,
    ...overrides,
  }
}

/** Epoch ms at local noon on a `YYYY-MM-DD`. */
function noonOn(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year as number, (month as number) - 1, day as number, 12).getTime()
}

describe('sortWithinGroup', () => {
  it('sorts by priority ascending — p0 first', () => {
    const p3 = todo({ priority: 3 })
    const p0 = todo({ priority: 0 })
    const p2 = todo({ priority: 2 })
    expect(sortWithinGroup([p3, p0, p2], 30).map((t) => t.priority)).toEqual([0, 2, 3])
  })

  it('puts the bigger task first at equal priority — it is the one to decide about', () => {
    const small = todo({ estimate_minutes: 15 })
    const big = todo({ estimate_minutes: 90 })
    expect(sortWithinGroup([small, big], 30).map((t) => t.estimate_minutes)).toEqual([90, 15])
  })

  it('sinks done and dropped below live work whatever their priority', () => {
    const donep0 = todo({ priority: 0, status: 'done' })
    const openp3 = todo({ priority: 3 })
    const dropped = todo({ priority: 0, status: 'dropped' })
    expect(sortWithinGroup([donep0, openp3, dropped], 30).map((t) => t.status)).toEqual([
      'open',
      'done',
      'dropped',
    ])
  })

  it('uses the settings estimate for a todo that has none', () => {
    const none = todo({ estimate_minutes: null })
    const twenty = todo({ estimate_minutes: 20 })
    // null falls back to 60, so it sorts ahead of the 20-minute task.
    expect(sortWithinGroup([twenty, none], 60)[0]?.id).toBe(none.id)
  })

  it('does not mutate the array it is given', () => {
    const input = [todo({ priority: 3 }), todo({ priority: 0 })]
    const before = input.map((t) => t.id)
    sortWithinGroup(input, 30)
    expect(input.map((t) => t.id)).toEqual(before)
  })
})

describe('groupByCategory', () => {
  it('keeps both research categories in Today alongside existing tasks', () => {
    const tasks = [
      todo({ category: 'personal' }),
      todo({ category: 'reinforcement-learning' }),
      todo({ category: 'ml-systems' }),
    ]
    const groups = groupByCategory(tasks, 30)
    expect(groups.map((group) => group.category)).toEqual([
      'ml-systems', 'reinforcement-learning', 'personal',
    ])
    expect(new Set(groups.flatMap((group) => group.todos.map((task) => task.id))))
      .toEqual(new Set(tasks.map((task) => task.id)))
  })

  it('groups in the comp order: recruiting, school, personal', () => {
    const groups = groupByCategory(
      [todo({ category: 'personal' }), todo({ category: 'recruiting' }), todo({ category: 'school' })],
      30
    )
    expect(groups.map((group) => group.category)).toEqual(['recruiting', 'school', 'personal'])
  })

  it('drops empty groups — an empty heading reads as something missing', () => {
    const groups = groupByCategory([todo({ category: 'school' })], 30)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.category).toBe('school')
  })

  it('sorts by priority inside each group independently', () => {
    const groups = groupByCategory(
      [
        todo({ category: 'school', priority: 3, text: 'school p3' }),
        todo({ category: 'school', priority: 0, text: 'school p0' }),
        todo({ category: 'recruiting', priority: 2, text: 'recruiting p2' }),
      ],
      30
    )
    expect(groups[1]?.todos.map((t) => t.text)).toEqual(['school p0', 'school p3'])
  })

  it('returns nothing at all for an empty day', () => {
    expect(groupByCategory([], 30)).toEqual([])
  })
})

describe('todaysList', () => {
  it('keeps open and doing work due today', () => {
    const open = todo({ status: 'open' })
    const doing = todo({ status: 'doing' })
    expect(todaysList([open, doing], TODAY).map((t) => t.id)).toEqual([open.id, doing.id])
  })

  it('keeps overdue work, because it is still today’s problem (PRD T7)', () => {
    const late = todo({ due: '2026-07-28' })
    expect(todaysList([late], TODAY)).toHaveLength(1)
  })

  it('excludes work due later', () => {
    expect(todaysList([todo({ due: '2026-08-05' })], TODAY)).toEqual([])
  })

  it('excludes undated work, so the backlog does not become "due today"', () => {
    expect(todaysList([todo({ due: null })], TODAY)).toEqual([])
  })

  it('keeps a task completed today, so ticking it does not make it vanish', () => {
    const done = todo({ status: 'done', completed_at: noonOn(TODAY) })
    expect(todaysList([done], TODAY)).toHaveLength(1)
  })

  it('excludes a task completed on an earlier day', () => {
    const done = todo({ status: 'done', completed_at: noonOn('2026-07-30') })
    expect(todaysList([done], TODAY)).toEqual([])
  })

  it('excludes dropped work — still in the vault and in search, just not today', () => {
    expect(todaysList([todo({ status: 'dropped' })], TODAY)).toEqual([])
  })
})

describe('rowMeta', () => {
  it('labels p0 and p1 so the gold edge is never the only signal', () => {
    expect(rowMeta(todo({ priority: 0, estimate_minutes: 90 }), 30)).toBe('p0 · 90m')
    expect(rowMeta(todo({ priority: 1, estimate_minutes: 15 }), 30)).toBe('p1 · 15m')
  })

  it('leaves p2 and p3 unlabelled — unmarked means normal', () => {
    expect(rowMeta(todo({ priority: 2, estimate_minutes: 45 }), 30)).toBe('45m')
    expect(rowMeta(todo({ priority: 3, estimate_minutes: 20 }), 30)).toBe('20m')
  })

  it('shows estimate against actual once a task is done', () => {
    expect(
      rowMeta(todo({ status: 'done', estimate_minutes: 30, actual_minutes: 45 }), 30)
    ).toBe('30m → 45m')
  })

  it('shows just the estimate when the actual was skipped', () => {
    expect(rowMeta(todo({ status: 'done', estimate_minutes: 30 }), 30)).toBe('30m')
  })

  it('falls back to the settings estimate', () => {
    expect(rowMeta(todo({ estimate_minutes: null }), 25)).toBe('25m')
  })
})

describe('overdueLabel', () => {
  it('says how late without saying it is a failure', () => {
    expect(overdueLabel(todo({ due: '2026-07-31' }), TODAY)).toBe('1 day late')
    expect(overdueLabel(todo({ due: '2026-07-28' }), TODAY)).toBe('4 days late')
  })

  it('is silent for anything due today or later, and for undated work', () => {
    expect(overdueLabel(todo({ due: TODAY }), TODAY)).toBeNull()
    expect(overdueLabel(todo({ due: '2026-08-09' }), TODAY)).toBeNull()
    expect(overdueLabel(todo({ due: null }), TODAY)).toBeNull()
  })

  it('counts whole days across a month boundary', () => {
    expect(overdueLabel(todo({ due: '2026-07-30' }), '2026-08-02')).toBe('3 days late')
  })
})

describe('openCountLabel', () => {
  it('counts open against done, and ignores dropped', () => {
    expect(
      openCountLabel([
        todo({ status: 'open' }),
        todo({ status: 'doing' }),
        todo({ status: 'done' }),
        todo({ status: 'dropped' }),
      ])
    ).toBe('2 open · 1 done')
  })

  it('reads as zeroes rather than as absence for an empty list', () => {
    expect(openCountLabel([])).toBe('0 open · 0 done')
  })
})

describe('actualOptions', () => {
  it('offers four taps around the estimate, rounded to five minutes', () => {
    expect(actualOptions(30)).toEqual([15, 30, 45, 60])
    expect(actualOptions(45)).toEqual([25, 45, 70, 90])
  })

  it('never offers zero, and never offers the same number twice', () => {
    const options = actualOptions(5)
    expect(options.every((value) => value > 0)).toBe(true)
    expect(new Set(options).size).toBe(options.length)
  })

  it('is always ascending, so the taps read left to right as longer', () => {
    for (const estimate of [5, 10, 15, 30, 90, 240]) {
      const options = actualOptions(estimate)
      expect([...options].sort((a, b) => a - b)).toEqual(options)
    }
  })
})
