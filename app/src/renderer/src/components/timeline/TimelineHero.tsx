import { scheduledEvent, scheduledWindow } from '@shared/scheduling'
import { useMemo } from 'react'
import type { CalendarEvent, DateString, DayLoad, Todo } from '@shared/types'

import { Card } from '@/components/Card'
import { Skeleton } from '@/components/Skeleton'
import { formatClock, formatMinutes } from '@/lib/date'
import { DayRail } from './DayRail'
import { OverflowTray } from './OverflowTray'
import {
  RAIL_START_MINUTE,
  freeGaps,
  nextEventAfter,
  packTodos,
  toRailEvents,
} from './schedule'

export interface TimelineHeroProps {
  date: DateString
  /** Null while the read is in flight or has failed. */
  events: readonly CalendarEvent[] | null
  todos: readonly Todo[] | null
  dayLoad: DayLoad | null
  fallbackEstimate: number
  /** Minutes since midnight. Re-rendered on a one-minute tick. */
  nowMinute: number
  loading: boolean
  error: Error | null
}

function clockAt(minute: number): string {
  const base = new Date()
  base.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
  return formatClock(base)
}

/**
 * The Today hero: the next thing, the day drawn, and what will not fit.
 *
 * This replaced an earlier hero that said the same thing as a sentence — "5h20m due
 * today · 3h10m free · over by 2h10m". That version was rejected, and the reason is the
 * whole design of this card: a total tells you that you are over, but not *which* task is
 * the one that is not going to happen. Seeing the gaps, and seeing three named tasks with
 * nowhere to go, is a decision. A number is only a mood.
 *
 * Overcommitment is gold here and nowhere near red — red is reserved for destroying
 * something, and being over is information.
 */
export function TimelineHero({
  date,
  events,
  todos,
  dayLoad,
  fallbackEstimate,
  nowMinute,
  loading,
  error,
}: TimelineHeroProps): React.JSX.Element {
  const railEvents = useMemo(() => toRailEvents([
    ...(events ?? []).filter((event) => event.busy !== false),
    ...(todos ?? []).map(scheduledEvent).filter((event): event is CalendarEvent => event !== null),
  ], date), [events, todos, date])

  // Only the todos the repository counted as fitting get drawn; `dayLoad.overflow` holds
  // the rest. One source of truth means the rail and the tray cannot contradict each
  // other.
  const { placed, unplaced } = useMemo(() => {
    if (!todos || !dayLoad) return { placed: [], unplaced: [] as Todo[] }
    const overflowIds = new Set(dayLoad.overflow.map((todo) => todo.id))
    const fitting = todos.filter((todo) => !scheduledWindow(todo) && !overflowIds.has(todo.id))
    const gaps = freeGaps(railEvents, Math.max(RAIL_START_MINUTE, nowMinute))
    return packTodos(fitting, gaps, fallbackEstimate)
  }, [todos, dayLoad, railEvents, nowMinute, fallbackEstimate])

  const next = nextEventAfter(railEvents, nowMinute)
  const nextLine = next
    ? `Next — ${next.title}, ${clockAt(next.start)}, in ${formatMinutes(next.start - nowMinute)}.`
    : 'Nothing else scheduled today.'

  const overflow = dayLoad?.overflow ?? []
  const overflowMinutes = [...overflow, ...unplaced].reduce(
    (total, todo) => total + (todo.estimate_minutes ?? fallbackEstimate),
    0
  )

  return (
    <Card className="bg-ruled relative overflow-hidden">
      <div className="relative flex flex-col gap-5">
        <p className="font-display text-[clamp(26px,2.7vw,34px)] leading-[1.25] tracking-tight">
          {error ? 'The day is here; the calendar just is not.' : nextLine}
        </p>

        <div className="flex items-stretch gap-5">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {loading && !dayLoad ? (
              <>
                <Skeleton height={13} width="100%" />
                <Skeleton height={96} radius="control" />
              </>
            ) : (
              <DayRail events={railEvents} placed={placed} nowMinute={nowMinute} />
            )}

            {error ? (
              <p className="text-muted text-xs">
                Today&apos;s tasks could not be read just now. Nothing was written, and
                nothing is lost — the vault is still the record.
              </p>
            ) : (
              <>
                <p
                  className={overflowMinutes > 0 ? 'text-accent-text text-xs' : 'text-muted text-xs'}
                >
                  {overflowMinutes > 0
                    ? `${formatMinutes(overflowMinutes)} of tasks don't fit today.`
                    : "Everything on today's list fits in the gaps."}
                </p>
                {dayLoad && <EstimateLine dayLoad={dayLoad} />}
              </>
            )}
          </div>

          <OverflowTray
            overflow={overflow}
            spilled={unplaced}
            fallbackEstimate={fallbackEstimate}
          />
        </div>
      </div>
    </Card>
  )
}

/**
 * PRD T5 and T11 in one line, set in italic Cormorant — the typography is itself the
 * disclaimer, and it is the same treatment the meal card uses for agent-estimated
 * calories. Everything on this line is derived, not measured.
 *
 * The calibrated figure appears **only** when `corrected_due_minutes` is non-null, which
 * the repository only does once a category has crossed 25 completions. An unconfident
 * multiplier is worse than no multiplier: a couple of unusual tasks swing it hard, and a
 * number you learn to distrust poisons the honest one next to it.
 */
export function EstimateLine({ dayLoad }: { dayLoad: DayLoad }): React.JSX.Element {
  const parts = [
    `${formatMinutes(dayLoad.free_minutes)} free`,
    `${formatMinutes(dayLoad.due_minutes)} estimated`,
  ]
  if (dayLoad.corrected_due_minutes !== null) {
    parts.push(`${formatMinutes(dayLoad.corrected_due_minutes)} realistically for you`)
  }
  return <p className="text-estimate text-base">{parts.join(' · ')}</p>
}
