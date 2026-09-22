import { Button } from '../Button'
import { describeResult, useSortInbox } from '@/store/sortInbox'

/**
 * Runs `/sort-inbox` — the same skill, the same scripts — from inside the app.
 *
 * Three things this deliberately does not do, each learned by actually running it:
 *
 *   · It does not show a spinner. A run takes 40–115 seconds, and a spinner that long
 *     reads as a hang, so the current step is named and the run can be stopped.
 *   · It does not report success when the run was partial. A denied tool means captures
 *     went unexamined, and a green check over that is a lie the user cannot catch.
 *   · It does not claim counts the model asserted. `filed` and `needsYou` are counted
 *     from the Inbox itself, before and after.
 */
export function SortInboxControl({ pending }: { pending: number }): React.JSX.Element | null {
  const { running, progress, result, error, available, sort, cancel, dismiss } = useSortInbox()

  // No CLI, nothing to sort, and nothing to report: the control has nothing to say.
  if (!available) return null
  if (!running && !result && !error && pending === 0) return null

  if (running) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-muted text-xs tabular-nums">
          {progress?.note ?? 'starting the sorter'}…
        </span>
        <Button variant="ghost" size="md" shape="pill" onClick={cancel} title="Stop the sort">
          Stop
        </Button>
      </span>
    )
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={dismiss}
        className="text-muted hover:text-ink text-xs"
        title={error}
      >
        Sort didn’t run — {error.split('.')[0]}. Dismiss
      </button>
    )
  }

  if (result) {
    return (
      <button
        type="button"
        onClick={dismiss}
        className="text-muted hover:text-ink text-left text-xs"
        title={result.summary}
      >
        {describeResult(result)}
        {result.degraded ? (
          // Partial runs say so. This is the branch that keeps the feature honest.
          <span className="text-accent-text block">
            Some captures may not have been examined.
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <Button
      variant="secondary"
      size="md"
      shape="pill"
      onClick={sort}
      title={`Route ${pending} capture${pending === 1 ? '' : 's'} into todos, meals, workouts and your library. Takes a minute or two.`}
    >
      Sort inbox
    </Button>
  )
}
