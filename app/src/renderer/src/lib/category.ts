import type { CSSProperties } from 'react'
import type { Category } from '@shared/types'

/** Category markers use distinct shapes as well as color so they remain identifiable. */

export type MarkerShape = 'square' | 'circle' | 'diamond' | 'hexagon' | 'triangle'

export const CATEGORY_LABEL: Record<Category, string> = {
  'ml-systems': 'ML Systems',
  'reinforcement-learning': 'Reinforcement Learning',
  recruiting: 'Recruiting',
  school: 'School',
  personal: 'Personal',
}

export const CATEGORY_SHAPE: Record<Category, MarkerShape> = {
  'ml-systems': 'hexagon',
  'reinforcement-learning': 'triangle',
  recruiting: 'square',
  school: 'circle',
  personal: 'diamond',
}

export const CATEGORY_COLOR: Record<Category, string> = {
  'ml-systems': 'var(--cat-ml-systems)',
  'reinforcement-learning': 'var(--cat-reinforcement-learning)',
  recruiting: 'var(--cat-recruiting)',
  school: 'var(--cat-school)',
  personal: 'var(--cat-personal)',
}

/** Research categories first, followed by the original categories. */
export const CATEGORY_ORDER: readonly Category[] = [
  'ml-systems', 'reinforcement-learning', 'recruiting', 'school', 'personal',
] as const

/**
 * A diamond is a rotated square, so at equal side length it reads heavier and its
 * bounding box is 1.41× wider. The comp compensates by drawing it at 7px where the
 * square and circle are 8px; this keeps that ratio at any size.
 */
const DIAMOND_RATIO = 0.875

/**
 * Inline style for a marker, for the places that cannot mount a component — SVG charts,
 * the Today rail's absolutely-positioned blocks, Recharts `fill` props.
 * Prefer `<CategoryMarker>` anywhere a DOM node is acceptable: it also carries the
 * accessible name.
 */
export function categoryMarkerStyle(category: Category, size = 8): CSSProperties {
  const shape = CATEGORY_SHAPE[category]
  const side = shape === 'diamond' ? Math.round(size * DIAMOND_RATIO * 100) / 100 : size
  return {
    width: `${side}px`,
    height: `${side}px`,
    flex: `0 0 ${side}px`,
    background: CATEGORY_COLOR[category],
    borderRadius: shape === 'circle' ? '99px' : '1px',
    transform: shape === 'diamond' ? 'rotate(45deg)' : 'none',
    clipPath: shape === 'hexagon'
      ? 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)'
      : shape === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' : undefined,
  }
}
