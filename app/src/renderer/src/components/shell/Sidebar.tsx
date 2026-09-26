import { useCallback, useState } from 'react'
import { InstinctDialog } from '../instinct/InstinctDialog'
import { cn } from '@/lib/cn'
import { ROUTE_IDS, ROUTES, type RouteId } from '@/lib/routes'
import { useUi } from '@/store/ui'
import { Button } from '../Button'
import { Eyebrow } from '../Card'
import { QUICK_CAPTURE_GLOBAL_HINT } from './QuickCapture'

export function Sidebar(): React.JSX.Element {
  const [instinctOpen, setInstinctOpen] = useState(false)
  const closeInstinct = useCallback(() => setInstinctOpen(false), [])
  const route = useUi((state) => state.route)
  const navigate = useUi((state) => state.navigate)
  const collapsed = useUi((state) => state.sidebarCollapsed)
  const toggleSidebar = useUi((state) => state.toggleSidebar)
  const openQuickCapture = useUi((state) => state.openQuickCapture)

  return (
    <aside
      className="border-line bg-bg2 pt-titlebar relative flex h-full flex-col gap-[30px] overflow-y-auto border-r px-[18px] pb-[30px]"
      style={{ width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)' }}
    >
      {/* macOS traffic lights float here under `titleBarStyle: 'hiddenInset'`. The strip
          gives the frameless window something to be dragged by. */}
      <div aria-hidden className="drag-region h-titlebar absolute inset-x-0 top-0" />

      <div className="flex items-start justify-between gap-2.5">
        <div
          className={cn(
            'flex min-w-0 flex-col gap-[3px] overflow-hidden whitespace-nowrap',
            'transition-opacity duration-[var(--duration-base)]',
            collapsed && 'pointer-events-none opacity-0'
          )}
        >
          <div className="font-display text-[29px] leading-[1.05] tracking-tight">Dès vu</div>
          <div className="font-display text-muted text-lg italic">
            one corpus,
            <br />
            many inputs
          </div>
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="no-drag transition-quiet border-line text-muted hover:bg-hover hover:text-ink flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border"
        >
          <span
            aria-hidden
            className="block h-[11px] w-[13px] rounded-[2px] border-[1.5px] border-l-[5px] border-current"
          />
        </button>
      </div>

      <nav className="flex shrink-0 flex-col gap-[3px]" aria-label="Surfaces">
        {ROUTE_IDS.map((id) => (
          <NavRow
            key={id}
            id={id}
            active={route === id}
            collapsed={collapsed}
            onSelect={() => navigate(id)}
          />
        ))}
      </nav>

      <div
        className={cn(
          'rounded-panel bg-card border-line mt-auto flex flex-col gap-2.5 border p-[15px] whitespace-nowrap',
          'transition-opacity duration-[var(--duration-base)]',
          collapsed && 'pointer-events-none opacity-0'
        )}
      >
        <Eyebrow>Capture</Eyebrow>
        <p className="font-display text-ink2 text-[15px] leading-[1.4] whitespace-normal">
          Text the bot, or press {QUICK_CAPTURE_GLOBAL_HINT}. It lands raw in the Inbox,
          sorted later.
        </p>
        <Button variant="soft" size="sm" full onClick={openQuickCapture} tabIndex={collapsed ? -1 : 0}>
          Quick capture
        </Button>
        <Button variant="soft" size="sm" full onClick={() => setInstinctOpen(true)} tabIndex={collapsed ? -1 : 0}>
          Instinct connection
        </Button>
      </div>
      {instinctOpen && <InstinctDialog onClose={closeInstinct} />}
    </aside>
  )
}

function NavRow({
  id,
  active,
  collapsed,
  onSelect,
}: {
  id: RouteId
  active: boolean
  collapsed: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? ROUTES[id].label : undefined}
      className={cn(
        'no-drag transition-quiet rounded-nav flex items-center gap-[11px] px-[11px] py-[9px] text-left text-base whitespace-nowrap',
        active ? 'bg-card text-ink font-medium' : 'text-ink2 hover:bg-hover hover:text-ink'
      )}
    >
      <span
        aria-hidden
        className={cn('rounded-pill h-1.5 w-1.5 flex-none', active ? 'bg-accent' : 'bg-soft')}
      />
      <span
        className={cn('transition-opacity duration-[var(--duration-base)]', collapsed && 'opacity-0')}
      >
        {ROUTES[id].label}
      </span>
    </button>
  )
}
