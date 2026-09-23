import { Button } from '../Button'
import { useCalendarSync } from '@/store/calendar'
import { useUi } from '@/store/ui'
export function CalendarControl(): React.JSX.Element {
  const { status, refreshing, lastResult } = useCalendarSync()
  const navigate = useUi((state) => state.navigate)
  const count = status?.accounts?.filter((a) => a.connected).length ?? 0
  return <Button variant="ghost" size="md" shape="pill" onClick={() => navigate('calendar')}
    title={lastResult?.error || 'Open Calendar and manage Google accounts'}>
    {refreshing ? 'Syncing calendars…' : count ? `Calendars · ${count} account${count === 1 ? '' : 's'}` : 'Calendar'}
  </Button>
}
