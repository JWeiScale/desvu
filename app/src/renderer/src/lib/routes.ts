/**
 * The six surfaces. These static routes do not need a router dependency — the whole
 * mechanism is `location.hash` plus a zustand field (`store/ui.ts`).
 */

export const ROUTE_IDS = [
  'today',
  'calendar',
  'journal',
  'explore',
  'meals',
  'brain-dump',
  'synthesis',
] as const

export type RouteId = (typeof ROUTE_IDS)[number]

/** PRD T9 — Today is the default surface on launch. */
export const DEFAULT_ROUTE: RouteId = 'today'

export interface RouteMeta {
  id: RouteId
  /** Sidebar label. */
  label: string
  /** Default page title. A surface may override it. */
  title: string
  /** One line, shown under the title, describing what the surface is for. */
  description: string
}

export const ROUTES: Record<RouteId, RouteMeta> = {
  calendar: {
    id: 'calendar', label: 'Calendar', title: 'Calendar',
    description: 'Make time for your work, alongside the calendars that shape your day.',
  },
  today: {
    id: 'today',
    label: 'Today',
    title: 'Today',
    description:
      'The day as one chronological rail — calendar events, todos placed into the gaps, and what will not fit.',
  },
  journal: {
    id: 'journal',
    label: 'Journal',
    title: 'Journal',
    description:
      'A rating is a whole entry. Everything else is optional, and a missed day is just a missed day.',
  },
  explore: {
    id: 'explore',
    label: 'Explore',
    title: 'Explore',
    description:
      'The library — everything you sent to the bot, fetched and summarized, browsable by type, status and tag.',
  },
  meals: {
    id: 'meals',
    label: 'Meals & training',
    title: 'Meals & training',
    description: 'What you ate and how you moved. Numbers are optional; logging is not blocked by them.',
  },
  'brain-dump': {
    id: 'brain-dump',
    label: 'Brain dump',
    title: 'Brain dump',
    description: 'Ongoing threads by topic, appended to rather than started over.',
  },
  synthesis: {
    id: 'synthesis',
    label: 'Synthesis',
    title: 'Synthesis',
    description: 'What the week actually looked like, with every claim linked back to its source.',
  },
}

export function isRouteId(value: string): value is RouteId {
  return (ROUTE_IDS as readonly string[]).includes(value)
}

export function routeFromHash(hash: string): RouteId {
  const candidate = hash.replace(/^#\/?/, '')
  return isRouteId(candidate) ? candidate : DEFAULT_ROUTE
}
