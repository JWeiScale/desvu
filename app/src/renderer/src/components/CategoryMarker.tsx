import type { Category } from '@shared/types'

import { CATEGORY_LABEL, CATEGORY_SHAPE, categoryMarkerStyle } from '@/lib/category'
import { cn } from '@/lib/cn'

export interface CategoryMarkerProps {
  category: Category
  /** Side length in px. The diamond is drawn at 0.875× so its visual weight matches. */
  size?: number
  /** Render the category name beside the marker, in the eyebrow style from the comp. */
  showLabel?: boolean
  /**
   * Set when adjacent text already names the category, so screen readers do not hear
   * "Recruiting, Recruiting". `showLabel` implies this.
   */
  decorative?: boolean
  className?: string
  labelClassName?: string
}

/** A shared shape and accessible label for each task category. */
export function CategoryMarker({
  category,
  size = 8,
  showLabel = false,
  decorative = false,
  className,
  labelClassName,
}: CategoryMarkerProps): React.JSX.Element {
  const shape = CATEGORY_SHAPE[category]
  const silent = decorative || showLabel

  const marker = (
    <span
      // The wrapper keeps a stable `size × size` footprint so a rotated diamond never
      // shifts the row it sits in.
      className={cn('inline-grid place-items-center', className)}
      style={{ width: size, height: size, flex: `0 0 ${size}px` }}
      {...(silent
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': CATEGORY_LABEL[category] })}
      data-category={category}
      data-shape={shape}
    >
      <span style={categoryMarkerStyle(category, size)} />
    </span>
  )

  if (!showLabel) return marker

  return (
    <span className="inline-flex items-center gap-2.5">
      {marker}
      <span
        className={cn(
          'text-label tracking-label text-muted uppercase',
          labelClassName
        )}
      >
        {CATEGORY_LABEL[category]}
      </span>
    </span>
  )
}

/**
 * The category markers with their names — for a filter bar or a chart legend. Anywhere the
 * reader has to learn the mapping once, show it once.
 */
export function CategoryLegend({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2', className)}>
      {(Object.keys(CATEGORY_LABEL) as Category[]).map((category) => (
        <CategoryMarker key={category} category={category} showLabel />
      ))}
    </div>
  )
}
