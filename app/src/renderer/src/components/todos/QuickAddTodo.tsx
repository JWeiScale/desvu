import { useState, type FormEvent } from 'react'
import type { Category, DateString, Priority } from '@shared/types'
import { CATEGORIES } from '@shared/types'

import { Button } from '@/components/Button'
import { Input, Select } from '@/components/Input'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '@/lib/category'
import { readableMessage } from '@/lib/bridge'
import { createTodo } from '@/store/todos'
import { PRIORITY_LABEL } from './grouping'

export interface QuickAddTodoProps {
  /** The due date new tasks get. Today, on this surface. */
  date: DateString
  defaultPriority: Priority
  defaultEstimate: number
  onAdded?: () => void
}

const PRIORITIES: Priority[] = [0, 1, 2, 3]

/**
 * PRD T1 · T3 · T4 — create a task without leaving the list.
 *
 * Everything except the text has a default, so the fast path is type-and-Enter. The three
 * pickers are visible rather than behind a disclosure because they are also the answer to
 * "what did I set that to?" — and because a capture that has to be corrected later is
 * most of the reason the Inbox exists.
 *
 * Failure keeps the text. Losing a typed task to a failed write is the worst thing this
 * form could do, so the field is only cleared after the write has actually landed.
 */
export function QuickAddTodo({
  date,
  defaultPriority,
  defaultEstimate,
  onAdded,
}: QuickAddTodoProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<Category>('school')
  const [priority, setPriority] = useState<Priority>(defaultPriority)
  const [estimate, setEstimate] = useState(String(defaultEstimate))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return

    const minutes = Number.parseInt(estimate, 10)
    setSaving(true)
    setError(null)
    try {
      await createTodo({
        text: trimmed,
        category,
        priority,
        estimate_minutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : defaultEstimate,
        due: date,
      })
      setText('')
      setPriority(defaultPriority)
      setEstimate(String(defaultEstimate))
      onAdded?.()
    } catch (thrown) {
      setError(readableMessage(thrown))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-line mb-4 flex flex-wrap items-end gap-3 border-b pb-4">
      <Input
        label="Add a task"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Rewrite the infra bullets"
        className="min-w-[210px] flex-1"
        error={error ?? undefined}
      />

      <Select
        label="Category"
        value={category}
        onChange={(event) => setCategory(event.target.value as Category)}
        className="w-[230px]"
      >
        {CATEGORY_ORDER.filter((option) => CATEGORIES.includes(option)).map((option) => (
          <option key={option} value={option}>
            {CATEGORY_LABEL[option]}
          </option>
        ))}
      </Select>

      <Select
        label="Priority"
        value={priority}
        onChange={(event) => setPriority(Number(event.target.value) as Priority)}
        className="w-[140px]"
      >
        {PRIORITIES.map((option) => (
          <option key={option} value={option}>
            {PRIORITY_LABEL[option]}
          </option>
        ))}
      </Select>

      <Input
        label="Estimate"
        type="number"
        min={0}
        step={5}
        inputMode="numeric"
        value={estimate}
        onChange={(event) => setEstimate(event.target.value)}
        className="w-[92px]"
      />

      <Button type="submit" variant="primary" loading={saving} disabled={text.trim() === ''}>
        Add
      </Button>
    </form>
  )
}
