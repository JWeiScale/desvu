import { useEffect, useState } from 'react'
import type { Category, Priority, Todo } from '@shared/types'
import { dateTimeInput } from '@shared/scheduling'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/Button'
import { Input, Select } from '@/components/Input'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '@/lib/category'
import { createTodo, updateTodo } from '@/store/todos'

export function ScheduleTaskDialog({ slot, tasks, onClose }: {
  slot: { day: string; minute: number; task?: Todo } | null; tasks: Todo[]; onClose: () => void
}): React.JSX.Element {
  const [taskId, setTaskId] = useState('')
  const [text, setText] = useState('')
  const [category, setCategory] = useState<Category>('ml-systems')
  const [priority, setPriority] = useState<Priority>(2)
  const [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [error, setError] = useState(''), [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!slot) return
    const at = new Date(`${slot.day}T00:00:00`); at.setMinutes(slot.minute)
    setTaskId(slot.task?.id ?? ''); setText(slot.task?.text ?? '')
    setCategory(slot.task?.category ?? 'ml-systems'); setPriority(slot.task?.priority ?? 2)
    setStart(dateTimeInput(at.toISOString()))
    setEnd(dateTimeInput(new Date(at.getTime() + Math.max(15, slot.task?.estimate_minutes ?? 30) * 60000).toISOString()))
    setError('')
  }, [slot])
  const save = async () => {
    if (!text.trim() || !start || !end || !(new Date(end) > new Date(start))) { setError('Enter a task and choose an end time after the start.'); return }
    setSaving(true); setError('')
    try {
      const schedule = { text: text.trim(), category, priority,
        scheduled_start: new Date(start).toISOString(), scheduled_end: new Date(end).toISOString() }
      if (taskId) await updateTodo(taskId, schedule)
      else await createTodo({ ...schedule, estimate_minutes: Math.round((Date.parse(end) - Date.parse(start)) / 60000) })
      onClose()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  return <Dialog open={Boolean(slot)} onClose={onClose} title="Schedule a task" description={`Times are in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`}
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} onClick={() => void save()}>Schedule</Button></>}>
    <Select label="Use an existing task" value={taskId} onChange={(e) => {
      setTaskId(e.target.value)
      const task = tasks.find((t) => t.id === e.target.value)
      setText(task?.text ?? ''); setCategory(task?.category ?? 'ml-systems'); setPriority(task?.priority ?? 2)
      if (task && start) setEnd(dateTimeInput(new Date(Date.parse(start) + Math.max(15, task.estimate_minutes ?? 30) * 60000).toISOString()))
    }}><option value="">Create a new task</option>{tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped').map((t) => <option key={t.id} value={t.id}>{t.text}</option>)}</Select>
    <Input label="Task" value={text} onChange={(e) => setText(e.target.value)} placeholder="Read a paper, write code, review notes…" error={error || undefined} />
    <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select>
    <div className="grid grid-cols-2 gap-3"><Input label="Start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /><Input label="End" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
  </Dialog>
}
