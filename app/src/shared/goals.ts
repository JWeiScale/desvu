import type { DateString, Goal } from './types'

/** Compare calendar dates, independent of daylight-saving changes or time of day. */
export function goalDaysRemaining(deadline: DateString, today: DateString): number {
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export function goalDeadlineLabel(goal: Pick<Goal, 'deadline' | 'status'>, today: DateString): string {
  if (goal.status === 'completed') return 'Completed'
  const days = goalDaysRemaining(goal.deadline, today)
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} past deadline`
  return `${days} days remaining`
}
