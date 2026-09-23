import { useCallback, useId, useRef, useState } from 'react'
import type { Goal } from '@shared/types'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Input, Textarea } from '@/components/Input'
import { readableMessage } from '@/lib/bridge'
import { createGoal, removeGoal, updateGoal } from '@/store/goals'

/** Mounted afresh for each goal, so unsaved values never leak into another editor. */
export function GoalDialog({ goal, onClose }: { goal: Goal | null; onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const working = useRef(false)
  const formId = useId()
  const close = useCallback(() => { if (!working.current) onClose() }, [onClose])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (thrown) {
      setError(readableMessage(thrown))
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={close} title={goal ? 'Edit goal' : 'New goal'} size="md"
      description="Choose what you want to accomplish and a deadline to work toward."
      className="max-h-[76vh] overflow-y-auto"
      footer={<>
        {goal && <Button variant="destructive" size="sm" disabled={busy}
          onClick={() => confirmingDelete ? void run(() => removeGoal(goal.id)) : setConfirmingDelete(true)}>
          {confirmingDelete ? 'Delete for good' : 'Delete'}
        </Button>}
        <span className="flex-1" />
        <Button size="sm" disabled={busy} onClick={close}>Cancel</Button>
        <Button variant="primary" size="sm" loading={busy} type="submit" form={formId}>
          {goal ? 'Save goal' : 'Create goal'}
        </Button>
      </>}
    >
      <form id={formId} onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim() || !deadline) { setError('Add a goal title and a deadline.'); return }
        const input = { title: title.trim(), deadline, notes }
        void run(() => goal ? updateGoal(goal.id, input) : createGoal(input))
      }}>
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
          <Input label="Goal" placeholder="What would you like to accomplish?" required
            value={title} onChange={(event) => setTitle(event.target.value)} />
          <Input label="Deadline" type="date" required value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            hint="Due through the end of this day. You can change it later." />
          <Textarea label="Notes (optional)" rows={4} value={notes}
            onChange={(event) => setNotes(event.target.value)} />
        </fieldset>
      </form>
      {error && <p role="alert" className="text-ink2 text-sm">{error}</p>}
      {confirmingDelete && <p className="text-muted text-xs">
        This permanently removes the goal and its notes. Choose Cancel to keep it.
      </p>}
    </Dialog>
  )
}
