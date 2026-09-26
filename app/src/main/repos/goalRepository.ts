import type { CreateGoalInput, Goal, UpdateGoalInput } from '@shared/types'
import { dataPath } from '@shared/vault'
import { CorruptFileError, NotFoundError } from '../lib/errors'
import { newId } from '../lib/ids'
import { createJsonStore, expectArray } from '../lib/json-store'
import { Issues, checkDate, checkNonEmptyText } from '../lib/validate'

function validate(input: UpdateGoalInput, partial = false): void {
  const issues = new Issues()
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    issues.add('Goal must be an object')
    issues.throwIfAny()
    return
  }
  if (!partial || input.title !== undefined) checkNonEmptyText(issues, 'Title', input.title)
  if (!partial || input.deadline !== undefined) checkDate(issues, 'Deadline', input.deadline)
  if (input.notes !== undefined && typeof input.notes !== 'string') issues.add('Notes must be text')
  if (input.status !== undefined && input.status !== 'active' && input.status !== 'completed') {
    issues.add('Status must be active or completed')
  }
  issues.throwIfAny()
}

const store = createJsonStore<Goal[]>(
  () => dataPath('goals.json'),
  () => [],
  (parsed, filePath) => {
    const goals = expectArray<Goal>(parsed, filePath)
    const ids = new Set<string>()
    for (const goal of goals) {
      try {
        validate(goal)
        if (typeof goal.id !== 'string' || !goal.id || ids.has(goal.id) ||
            typeof goal.notes !== 'string' ||
            !['active', 'completed'].includes(goal.status) ||
            !Number.isFinite(goal.created_at) || !Number.isFinite(goal.updated_at) ||
            (goal.status === 'active' ? goal.completed_at !== null : !Number.isFinite(goal.completed_at))) {
          throw new Error('Invalid goal metadata')
        }
        ids.add(goal.id)
      } catch {
        throw new CorruptFileError(filePath, 'a goal has invalid fields or a duplicate id')
      }
    }
    return goals
  }
)

export const goalRepository = {
  async list(): Promise<Goal[]> {
    return (await store.read()).sort((a, b) =>
      a.deadline.localeCompare(b.deadline) || a.created_at - b.created_at || a.id.localeCompare(b.id)
    )
  },

  async create(input: CreateGoalInput, importId?: string): Promise<Goal> {
    validate(input)
    return store.mutate((current) => {
      const previous = importId ? current.find((goal) => goal.id === importId) : undefined
      if (previous) return { data: current, result: previous, write: false }
      const now = Date.now()
      const goal: Goal = {
        id: importId ?? newId(), title: input.title.trim(), deadline: input.deadline,
        notes: input.notes ?? '', status: 'active',
        created_at: now, updated_at: now, completed_at: null,
      }
      return { data: [...current, goal], result: goal }
    })
  },

  async update(id: string, updates: UpdateGoalInput): Promise<Goal> {
    validate(updates, true)
    return store.mutate((current) => {
      const index = current.findIndex((goal) => goal.id === id)
      if (index === -1) throw new NotFoundError(`No goal with id ${id}`)
      const previous = current[index]!
      const status = updates.status ?? previous.status
      const now = Date.now()
      const goal: Goal = {
        ...previous,
        title: updates.title === undefined ? previous.title : updates.title.trim(),
        deadline: updates.deadline ?? previous.deadline,
        notes: updates.notes ?? previous.notes,
        status,
        updated_at: now,
        completed_at: status === 'completed' ? previous.completed_at ?? now : null,
      }
      current[index] = goal
      return { data: current, result: goal }
    })
  },

  async remove(id: string): Promise<void> {
    await store.mutate((current) => {
      if (!current.some((goal) => goal.id === id)) throw new NotFoundError(`No goal with id ${id}`)
      return { data: current.filter((goal) => goal.id !== id), result: undefined }
    })
  },
}
