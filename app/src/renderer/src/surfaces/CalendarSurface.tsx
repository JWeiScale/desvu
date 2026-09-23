import { useEffect, useMemo, useRef, useState } from 'react'
import type { Todo } from '@shared/types'
import { localDay, scheduledWindow, shiftDay } from '@shared/scheduling'
import { Page } from '@/components/Page'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Dialog } from '@/components/Dialog'
import { CategoryMarker } from '@/components/CategoryMarker'
import { TodoEditDialog } from '@/components/todos/TodoEditDialog'
import { ScheduleTaskDialog } from '@/components/calendar/ScheduleTaskDialog'
import { GoogleAccountsDialog } from '@/components/calendar/GoogleAccountsDialog'
import { itemsForDay, positionItems, taskAtTime, timeLabel, visibleDays, type CalendarItem, type CalendarView } from '@/components/calendar/model'
import { CATEGORY_COLOR } from '@/lib/category'
import { ROUTES } from '@/lib/routes'
import { clearCalendarRange, useCalendarRange, useCalendarSync } from '@/store/calendar'
import { useNowMinute } from '@/components/timeline/useNowMinute'
import { updateTodo, useTodos, useTodosForDate } from '@/store/todos'

const HOUR_HEIGHT = 64
const TASK_TRANSFER = 'application/x-desvu-task'
export function CalendarSurface(): React.JSX.Element {
  const [anchor, setAnchor] = useState(() => localDay(new Date()))
  const [view, setView] = useState<CalendarView>('week')
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [slot, setSlot] = useState<{ day: string; minute: number; task?: Todo } | null>(null)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [detail, setDetail] = useState<CalendarItem | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const nowMinute = useNowMinute()
  const today = localDay(new Date())
  const days = useMemo(() => visibleDays(anchor, view), [anchor, view])
  const from = days[0]!, to = days[days.length - 1]!
  const tasks = useTodos()
  useTodosForDate(today) // Materialize only today, never future days while browsing.
  const events = useCalendarRange(from, to)
  const sync = useCalendarSync()
  const scroller = useRef<HTMLDivElement>(null)
  const connected = Boolean(sync.status?.connected)
  const refresh = sync.refresh
  useEffect(() => { if (connected) void refresh({ from, to }) }, [from, to, connected, refresh])
  useEffect(() => () => clearCalendarRange(), [])
  useEffect(() => { if (scroller.current && view !== 'month') scroller.current.scrollTop = 7 * HOUR_HEIGHT }, [view, anchor])
  const allTasks = tasks.data ?? []
  const unscheduled = allTasks.filter((task) => !scheduledWindow(task) && task.status !== 'done' && task.status !== 'dropped')
  const dayItems = useMemo(() => new Map(days.map((day) => [day, itemsForDay(tasks.data ?? [], events.data ?? [], day)])), [days, tasks.data, events.data])
  const move = async (id: string, day: string, minute: number) => {
    const task = allTasks.find((t) => t.id === id)
    if (!task || saving) return
    setSaving(true); setError('')
    try { await updateTodo(id, taskAtTime(task, day, minute)); setSelected(null) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  const chooseSlot = (day: string, minute: number) => {
    const task = allTasks.find((t) => t.id === selected)
    setSlot({ day, minute, ...(task ? { task } : {}) }); setSelected(null)
  }
  const openItem = (item: CalendarItem) => { if (item.task) setEditing(item.task); else setDetail(item) }
  const navigate = (direction: number) => {
    if (view === 'month') {
      const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00`); date.setMonth(date.getMonth() + direction); setAnchor(localDay(date))
    } else setAnchor(shiftDay(anchor, direction * (view === 'week' ? 7 : 1)))
  }
  const gridColumns = `56px repeat(${view === 'day' ? 1 : 7}, minmax(${view === 'day' ? 280 : 100}px, 1fr))`
  return <Page title={ROUTES.calendar.title} eyebrow={new Date(`${anchor}T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' })}
    description={ROUTES.calendar.description} actions={<Button variant="secondary" onClick={() => setAccountsOpen(true)}>Google accounts</Button>}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Button aria-label="Previous period" variant="secondary" size="sm" onClick={() => navigate(-1)}>‹</Button><Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>Today</Button><Button aria-label="Next period" variant="secondary" size="sm" onClick={() => navigate(1)}>›</Button>
        <span className="ml-2 text-sm">{view === 'day' ? new Date(`${anchor}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : view === 'week' ? `${new Date(from + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(to + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</span></div>
      <div className="flex flex-wrap items-center gap-2">
        {(['day', 'week', 'month'] as const).map((mode) => <Button key={mode} size="sm" variant={view === mode ? 'primary' : 'ghost'} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode[0]!.toUpperCase() + mode.slice(1)}</Button>)}
        {connected && <Button variant="ghost" size="sm" loading={sync.refreshing} onClick={() => void refresh({ from, to })}>Sync</Button>}
        <Button variant="primary" size="sm" onClick={() => chooseSlot(anchor, 9 * 60)}>Schedule task</Button>
      </div>
    </div>
    <p className="mb-3 text-xs text-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone} · Click a time to schedule. Drag tasks to move them.</p>
    {(error || tasks.error || events.error) && <p role="alert" className="mb-3 text-sm text-accent-text">{error || tasks.error?.message || events.error?.message}</p>}
    {sync.lastResult?.error && connected && <p role="status" className="mb-3 whitespace-pre-line text-xs text-accent-text">Some calendars could not sync. Previously imported events are still shown.<br />{sync.lastResult.error}</p>}
    <div className="flex min-w-0 flex-col items-start gap-5 2xl:flex-row">
      <div className="w-full min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-card">
        {view === 'month' ? <>
          <div className="grid grid-cols-7 border-b border-line bg-bg2">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-3 text-center text-xs text-muted">{d}</div>)}</div>
          <div className="grid grid-cols-7">{days.map((day) => {
            const items = dayItems.get(day) ?? []
            return <div key={day} className="min-h-[128px] border-r border-b border-line p-2" style={{ opacity: day.slice(0, 7) === anchor.slice(0, 7) ? 1 : 0.55 }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(TASK_TRANSFER)) e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData(TASK_TRANSFER); const task = allTasks.find((t) => t.id === id); if (task) { const block = scheduledWindow(task); void move(id, day, block ? block.start.getHours() * 60 + block.start.getMinutes() : 9 * 60) } }}>
              <button className={`mb-2 grid h-7 w-7 place-items-center rounded-full text-sm ${day === today ? 'bg-accent text-on-accent' : 'hover:bg-hover'}`} onClick={() => { setAnchor(day); setView('day') }} aria-label={`Open ${day}`}>{Number(day.slice(8))}</button>
              {items.slice(0, 4).map((item) => <button key={item.id} className="mb-1 block w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:bg-hover" style={{ borderLeft: `3px solid ${item.task ? CATEGORY_COLOR[item.task.category] : item.color ?? 'var(--accent)'}`, background: 'var(--bg2)' }}
                onClick={() => openItem(item)} draggable={Boolean(item.task) && !saving} onDragStart={(e) => { if (item.task) e.dataTransfer.setData(TASK_TRANSFER, item.task.id) }} title={item.title}>
                {!item.allDay && <span className="mr-1 text-muted">{timeLabel(item.start)}</span>}{item.task?.status === 'done' ? '✓ ' : ''}{item.title}
              </button>)}
              {items.length > 4 && <button className="text-xs text-muted" onClick={() => { setAnchor(day); setView('day') }}>+{items.length - 4} more</button>}
            </div>
          })}</div>
        </> : <div ref={scroller} className="max-h-[620px] overflow-auto">
          <div className="sticky top-0 z-30 grid border-b border-line bg-card" style={{ gridTemplateColumns: gridColumns }}><div />{days.map((day) => <button key={day} className={`border-l border-line px-2 py-3 text-center ${day === today ? 'text-accent-text' : ''}`} onClick={() => { setAnchor(day); setView('day') }}>
            <span className="block text-xs uppercase">{new Date(day + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })}</span><span className="font-display text-2xl">{Number(day.slice(8))}</span>
          </button>)}</div>
          <div className="grid border-b border-line bg-bg2" style={{ gridTemplateColumns: gridColumns }}><span className="p-2 text-[10px] text-muted">All day /<br />untimed</span>{days.map((day) => <div key={day} className="min-h-[44px] border-l border-line p-1">{(dayItems.get(day) ?? []).filter((item) => item.allDay).map((item) => <button key={item.id} className="mb-1 block w-full truncate rounded bg-card px-2 py-1 text-left text-[11px]" title={item.title} onClick={() => openItem(item)} draggable={Boolean(item.task)} onDragStart={(e) => { if (item.task) e.dataTransfer.setData(TASK_TRANSFER, item.task.id) }}>{item.task ? '◇ ' : ''}{item.title}</button>)}</div>)}</div>
          <div className="grid" style={{ gridTemplateColumns: gridColumns }}>
            <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute right-2 text-[10px] text-muted" style={{ top: hour * HOUR_HEIGHT + 4 }}>{hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}</span>)}</div>
            {days.map((day) => <div key={day} className="relative border-l border-line" style={{ height: 24 * HOUR_HEIGHT }}>
              {Array.from({ length: 48 }, (_, index) => <button key={index} className="absolute inset-x-0 border-t border-line text-left hover:bg-soft focus-visible:bg-soft" style={{ top: index * HOUR_HEIGHT / 2, height: HOUR_HEIGHT / 2, borderTopStyle: index % 2 ? 'dotted' : 'solid' }} aria-label={`Schedule on ${day} at ${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`} onClick={() => chooseSlot(day, index * 30)}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(TASK_TRANSFER)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                onDrop={(e) => { e.preventDefault(); void move(e.dataTransfer.getData(TASK_TRANSFER), day, index * 30) }} />)}
              {positionItems(dayItems.get(day) ?? [], day).map((item) => <button key={item.id} className="absolute z-10 overflow-hidden rounded-md border border-line px-1.5 py-1 text-left shadow-sm hover:brightness-95" style={{
                top: item.startMinute / 60 * HOUR_HEIGHT, height: Math.max(24, (item.endMinute - item.startMinute) / 60 * HOUR_HEIGHT - 2),
                left: `calc(${item.column / item.columns * 100}% + 2px)`, width: `calc(${100 / item.columns}% - 4px)`,
                background: item.task ? 'var(--bg2)' : 'var(--card2)', borderLeft: `3px solid ${item.task ? CATEGORY_COLOR[item.task.category] : item.color ?? 'var(--accent)'}`,
                opacity: item.task?.status === 'done' ? 0.55 : 1,
              }} onClick={() => openItem(item)} title={`${item.title}\n${timeLabel(item.start)}–${timeLabel(item.end)}\n${item.event?.calendar_name ?? 'Dès vu task'}${item.event?.account_email ? ' · ' + item.event.account_email : ''}`} draggable={Boolean(item.task) && !saving} onDragStart={(e) => { if (item.task) e.dataTransfer.setData(TASK_TRANSFER, item.task.id) }}>
                <span className="block text-[10px] text-muted">{timeLabel(item.start)}–{timeLabel(item.end)}</span>
                <span className="block text-xs font-medium leading-tight">{item.task?.status === 'done' ? '✓ ' : ''}{item.title}</span>
                {item.event && <span className="mt-1 block truncate text-[10px] text-muted">{item.event.calendar_name ?? 'Google Calendar'}</span>}
              </button>)}
              {day === today && <div className="pointer-events-none absolute inset-x-0 z-20 border-t border-accent" style={{ top: nowMinute / 60 * HOUR_HEIGHT }} />}
            </div>)}
          </div>
        </div>}
      </div>
      <div className="w-full flex-none 2xl:w-[250px]">
        <Card title="Tasks without a time" meta={`${unscheduled.length}`}>
          <p className="mb-3 text-xs text-muted">Drag a task onto the calendar, or select it and click a time.</p>
          {unscheduled.length === 0 && <p className="text-sm text-muted">Every open task has a time. Use Schedule task to add another.</p>}
          <div className="flex max-h-[400px] flex-col gap-2 overflow-y-auto">{unscheduled.map((task) => <button key={task.id} className={`rounded-field border p-3 text-left ${selected === task.id ? 'border-accent bg-soft' : 'border-line bg-bg2 hover:bg-hover'}`} aria-pressed={selected === task.id} draggable={!saving} onDragStart={(e) => e.dataTransfer.setData(TASK_TRANSFER, task.id)} onClick={() => setSelected(selected === task.id ? null : task.id)}>
            <span className="flex items-start gap-2"><CategoryMarker category={task.category} /><span className="text-sm">{task.text}</span></span><span className="mt-1 block text-xs text-muted">{task.estimate_minutes ?? 30} min{task.due ? ` · ${task.due}` : ''}</span>
          </button>)}</div>
        </Card>
        {!connected && <div className="mt-4 rounded-card border border-line p-4"><p className="mb-2 text-sm">Connect Google to see meetings beside your tasks.</p><Button variant="secondary" size="sm" onClick={() => setAccountsOpen(true)}>Connect calendars</Button></div>}
      </div>
    </div>
    <ScheduleTaskDialog slot={slot} tasks={allTasks} onClose={() => setSlot(null)} />
    <TodoEditDialog todo={editing} onClose={() => setEditing(null)} />
    <GoogleAccountsDialog open={accountsOpen} onClose={() => setAccountsOpen(false)} />
    <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title ?? 'Calendar event'} footer={<Button variant="primary" onClick={() => setDetail(null)}>Done</Button>}>
      {detail && <><p className="text-sm">{detail.allDay ? 'All-day event' : `${new Date(detail.start).toLocaleString()} – ${new Date(detail.end).toLocaleString()}`}</p><p className="text-sm text-muted">{detail.event?.calendar_name}{detail.event?.account_email ? ` · ${detail.event.account_email}` : ''}</p>{detail.event?.location && <p className="text-sm">{detail.event.location}</p>}<p className="text-xs text-muted">Imported from Google. Edit this event in Google Calendar, then sync here.</p></>}
    </Dialog>
  </Page>
}
