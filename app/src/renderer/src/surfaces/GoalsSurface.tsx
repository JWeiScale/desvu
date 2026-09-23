import { useCallback, useRef, useState } from 'react'
import type { Goal, GoalStatus } from '@shared/types'
import { goalDeadlineLabel } from '@shared/goals'
import { localDay } from '@shared/scheduling'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Page } from '@/components/Page'
import { GoalDialog } from '@/components/goals/GoalDialog'
import { useNowMinute } from '@/components/timeline/useNowMinute'
import { readableMessage } from '@/lib/bridge'
import { ROUTES } from '@/lib/routes'
import { updateGoal, useGoals } from '@/store/goals'

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function GoalsSurface(): React.JSX.Element {
  const query = useGoals()
  const [filter, setFilter] = useState<GoalStatus | 'all'>('active')
  const [editor, setEditor] = useState<Goal | 'new' | null>(null)
  const closeEditor = useCallback(() => setEditor(null), [])
  useNowMinute()
  const today = localDay(new Date())
  const goals = query.data ?? []
  const active = goals.filter((goal) => goal.status === 'active')
  const visible = goals.filter((goal) => filter === 'all' || goal.status === filter)
  const counts = { active: active.length, completed: goals.length - active.length, all: goals.length }

  return (
    <Page title="Goals" description={ROUTES.goals.description}
      actions={<Button variant="primary" size="sm" onClick={() => setEditor('new')}>New goal</Button>}>
      <Card title="Your goals" meta="Nearest deadlines first">
        <div role="group" aria-label="Filter goals" className="mb-5 flex flex-wrap gap-2">
          {(['active', 'completed', 'all'] as const).map((value) => <Button key={value} size="sm"
            variant={filter === value ? 'soft' : 'ghost'} aria-pressed={filter === value}
            onClick={() => setFilter(value)}>
            {value === 'active' ? 'Active' : value === 'completed' ? 'Completed' : 'All'} ({counts[value]})
          </Button>)}
        </div>
        {query.error ? <div className="flex items-center gap-3" role="alert">
          <p className="text-muted text-sm">{readableMessage(query.error)}</p>
          <Button size="sm" onClick={query.refetch}>Try again</Button>
        </div> : !query.settled ? <p role="status" className="text-muted text-sm">Loading goals…</p>
          : visible.length === 0 ? <EmptyState
            title={filter === 'completed' ? 'Completed goals will appear here.' : filter === 'active' && goals.length ? 'Your goals are complete.' : 'Give your next goal a deadline.'}
            action={filter !== 'completed' ? <Button variant="soft" size="sm" onClick={() => setEditor('new')}>New goal</Button> : undefined}>
            {filter === 'completed' ? 'Mark a goal complete when you reach it.' : 'Add a title, choose a date, and keep your next milestone in view.'}
          </EmptyState> : <ul className="divide-line divide-y">
            {visible.map((goal) => <GoalRow key={goal.id} goal={goal} today={today} onEdit={() => setEditor(goal)} />)}
          </ul>}
      </Card>
      {editor && <GoalDialog key={editor === 'new' ? 'new' : editor.id}
        goal={editor === 'new' ? null : editor} onClose={closeEditor} />}
    </Page>
  )
}

function GoalRow({ goal, today, onEdit }: { goal: Goal; today: string; onEdit: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const working = useRef(false)
  const completed = goal.status === 'completed'

  const toggle = async (): Promise<void> => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try { await updateGoal(goal.id, { status: completed ? 'active' : 'completed' }) }
    catch (thrown) { setError(readableMessage(thrown)) }
    finally { working.current = false; setBusy(false) }
  }

  return <li className="flex flex-wrap items-start justify-between gap-4 py-5 first:pt-0 last:pb-0">
    <div className="min-w-0 flex-1 basis-[260px]">
      <button type="button" onClick={onEdit} disabled={busy}
        aria-label={`Edit goal: ${goal.title}`} className="text-ink text-left font-medium break-words hover:underline">
        {goal.title}
      </button>
      <div className="text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>Deadline <time dateTime={goal.deadline}>{DATE_FORMAT.format(new Date(`${goal.deadline}T12:00:00`))}</time></span>
        <span className={completed ? '' : 'text-accent-text'}>{goalDeadlineLabel(goal, today)}</span>
      </div>
      {goal.notes && <p className="text-ink2 mt-3 line-clamp-3 whitespace-pre-wrap break-words text-sm">{goal.notes}</p>}
      {error && <p role="alert" className="text-muted mt-2 text-sm">{error}</p>}
    </div>
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit} aria-label={`Edit goal: ${goal.title}`}>Edit</Button>
      <Button size="sm" variant={completed ? 'secondary' : 'soft'} loading={busy} onClick={() => void toggle()}
        aria-label={`${completed ? 'Reopen' : 'Complete'} goal: ${goal.title}`}>
        {completed ? 'Reopen' : 'Mark complete'}
      </Button>
    </div>
  </li>
}
