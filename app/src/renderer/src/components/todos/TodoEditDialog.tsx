import { dateTimeInput } from '@shared/scheduling'
import { useEffect, useState } from 'react'
import type { Category, Priority, Todo } from '@shared/types'

import { Button } from '@/components/Button'
import { Input, Select, Textarea } from '@/components/Input'
import { readableMessage } from '@/lib/bridge'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '@/lib/category'
import { Dialog } from '@/components/Dialog'
import { dropTodo, removeTodo, reopenTodo, updateTodo } from '@/store/todos'
import { PRIORITY_LABEL } from './grouping'

export interface TodoEditDialogProps {
  /** Null closes the dialog. */
  todo: Todo | null
  onClose: () => void
}

const PRIORITIES: Priority[] = [0, 1, 2, 3]

/**
 * PRD T1 — edit, drop, delete. One task, one dialog.
 *
 * Drop and delete are different things and are drawn as different things. **Drop** sets
 * the status and is reversible: the record stays in the corpus, stays in search (PRD S3),
 * and stays in the estimate-vs-actual history. **Delete** removes it, and is the only
 * control on this surface that is allowed to be red.
 *
 * The confirm step for delete is a second click on the same button, not a second dialog.
 */
export function TodoEditDialog({ todo, onClose }: TodoEditDialogProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<Category>('personal')
  const [priority, setPriority] = useState<Priority>(2)
  const [estimate, setEstimate] = useState('')
  const [due, setDue] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Reopening the dialog on a different task must not show the last one's values.
  useEffect(() => {
    if (!todo) return
    setText(todo.text)
    setCategory(todo.category)
    setPriority(todo.priority)
    setEstimate(todo.estimate_minutes === null ? '' : String(todo.estimate_minutes))
    setDue(todo.due ?? '')
    setStart(dateTimeInput(todo.scheduled_start))
    setEnd(dateTimeInput(todo.scheduled_end))
    setNotes(todo.notes)
    setError(null)
    setConfirmingDelete(false)
  }, [todo])

  if (!todo) return <Dialog open={false} onClose={onClose} title="Task" />

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (thrown) {
      setError(readableMessage(thrown))
    } finally {
      setBusy(false)
    }
  }

  const save = (): Promise<void> => {
    if ((start || end) && (!start || !end || !(new Date(end) > new Date(start)))) {
      setError('Choose a start time and an end time after it.'); return Promise.resolve()
    }
    const minutes = Number.parseInt(estimate, 10)
    return run(() =>
      updateTodo(todo.id, {
        text: text.trim(),
        category,
        priority,
        estimate_minutes: estimate.trim() === '' ? null : Number.isFinite(minutes) ? minutes : null,
        due: due.trim() === '' ? null : due,
        notes,
        scheduled_start: start ? new Date(start).toISOString() : null,
        scheduled_end: end ? new Date(end).toISOString() : null,
      })
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Task"
      description={
        todo.recurrence_parent !== null
          ? 'One instance of a repeating task. Editing it changes this copy, not the rule.'
          : undefined
      }
      size="md"
      className="max-h-[76vh] overflow-y-auto"
      footer={
        <>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() =>
              confirmingDelete ? void run(() => removeTodo(todo.id)) : setConfirmingDelete(true)
            }
          >
            {confirmingDelete ? 'Delete for good' : 'Delete'}
          </Button>
          <span className="flex-1" />
          {todo.status === 'done' ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => reopenTodo(todo.id))}>
              Reopen
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => dropTodo(todo.id))}>
              Drop
            </Button>
          )}
          <Button variant="primary" size="sm" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Task"
          value={text}
          onChange={(event) => setText(event.target.value)}
          error={error ?? undefined}
        />

        <div className="flex flex-wrap gap-3">
          <Select
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
            className="min-w-[140px] flex-1"
          >
            {CATEGORY_ORDER.map((option) => (
              <option key={option} value={option}>
                {CATEGORY_LABEL[option]}
              </option>
            ))}
          </Select>

          <Select
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value) as Priority)}
            className="min-w-[160px] flex-1"
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
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
            className="w-[104px]"
            hint="minutes"
          />

          <Input
            label="Due"
            type="date"
            value={start ? start.slice(0, 10) : due}
            disabled={Boolean(start)}
            hint={start ? 'Set by scheduled start' : undefined}
            onChange={(event) => setDue(event.target.value)}
            className="w-[160px]"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Input label="Scheduled start" type="datetime-local" value={start} onChange={(event) => {
            const value = event.target.value; setStart(value)
            if (value) setDue(value.slice(0, 10))
            if (value && !end) setEnd(dateTimeInput(new Date(new Date(value).getTime() + (todo.estimate_minutes ?? 30) * 60000).toISOString()))
          }} className="min-w-[220px] flex-1" />
          <Input label="Scheduled end" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="min-w-[220px] flex-1" />
          {(start || end) && <Button variant="ghost" size="sm" onClick={() => { setStart(''); setEnd('') }}>Remove time</Button>}
        </div>
        <p className="text-muted text-xs">Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Scheduled tasks appear in Calendar.</p>

        <Textarea
          label="Notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />

        {confirmingDelete && (
          <p className="text-muted text-xs">
            Deleting removes this task from the vault. Dropping keeps it — off the list,
            still in search, still part of your estimate history.
          </p>
        )}
      </div>
    </Dialog>
  )
}
