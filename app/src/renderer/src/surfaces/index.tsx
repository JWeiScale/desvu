import type { RouteId } from '@/lib/routes'
import { BrainDumpSurface } from './BrainDumpSurface'
import { ExploreSurface } from './ExploreSurface'
import { JournalSurface } from './JournalSurface'
import { MealsSurface } from './MealsSurface'
import { SynthesisSurface } from './SynthesisSurface'
import { TodaySurface } from './TodaySurface'

/**
 * One component per surface. Each returns exactly one `<Page>` — that is the whole
 * surface contract, and `<Page>` owns everything above the content column.
 *
 * Each surface lives in its own file so they can be built independently. To build one,
 * replace the <Placeholder> inside its file. Do not add chrome, do not add a second
 * Page, and do not reach around `<Page>` to style the frame.
 */
export const SURFACES: Record<RouteId, () => React.JSX.Element> = {
  today: TodaySurface,
  journal: JournalSurface,
  explore: ExploreSurface,
  meals: MealsSurface,
  'brain-dump': BrainDumpSurface,
  synthesis: SynthesisSurface,
}
