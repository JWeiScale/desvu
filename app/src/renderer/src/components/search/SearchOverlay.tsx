import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SearchHit } from '@shared/types'

import { Button } from '@/components/Button'
import { Eyebrow } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { Select } from '@/components/Input'
import { SkeletonLines } from '@/components/Skeleton'
import { readableMessage } from '@/lib/bridge'
import { toDateString } from '@/lib/date'
import { useUi } from '@/store/ui'
import { openInObsidian, useSearch } from './data'
import { SearchResultRow } from './SearchResultRow'
import {
  ALL_KINDS,
  DATE_WINDOW_LABEL,
  DEFAULT_SEARCH_FILTERS,
  KIND_LABEL,
  applySearchFilters,
  flattenGroups,
  groupHits,
  hitKey,
  kindCounts,
  normalizeTerms,
  primaryAction,
  secondaryAction,
  type DateWindow,
  type SearchAction,
  type SearchFilters,
} from './search'

const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const OPEN_HINT = IS_MAC ? '⌘K' : 'Ctrl+K'
const DATE_WINDOWS: DateWindow[] = ['all', '7d', '30d', '365d']

/** Same set `Dialog` uses, so the two behave identically under Tab. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * PRD S1–S3 — one input over the whole corpus.
 *
 * PKM tools are consistently strong at capture and weak at recall, which is why this is a
 * Must. It reaches everything: todos (including the completed and dropped ones), journal
 * entries, library items (including the ones that have stepped out of the queue), brain
 * dump threads, synthesis notes, meals and training. Nothing that a default
 * view hides is hidden from here — see the note at the top of `search.ts`.
 *
 * Mounted once at the app root, opens on ⌘K from anywhere. Quick capture is ⌘⇧K, so the
 * shift key is what tells them apart.
 */
export function SearchOverlay(): React.JSX.Element | null {
  // Open state lives in the ui store, not here, so the header's Search pill can open it.
  // ⌘K alone is undiscoverable, and a recall feature nobody finds does not exist.
  const open = useUi((state) => state.searchOpen)
  const setOpen = useUi((state) => state.setSearchOpen)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_SEARCH_FILTERS)
  const [selected, setSelected] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const navigate = useUi((state) => state.navigate)

  const search = useSearch(open ? query : '')
  const today = toDateString()

  const hits = useMemo(() => search.data ?? [], [search.data])
  const counts = useMemo(() => kindCounts(hits), [hits])
  const filtered = useMemo(
    () => applySearchFilters(hits, filters, today),
    [hits, filters, today]
  )
  const groups = useMemo(() => groupHits(filtered), [filtered])
  const flat = useMemo(() => flattenGroups(groups), [groups])
  const terms = useMemo(() => normalizeTerms(query), [query])

  const close = useCallback((): void => {
    setOpen(false)
    setProblem(null)
  }, [])

  // ⌘K anywhere. Shift is deliberately excluded so ⌘⇧K stays quick capture.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!open)
        return
      }
      if (!open) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return

      // Keep Tab inside the overlay, the same way `Dialog` does — focus must not walk
      // out behind the scrim onto a surface the user cannot see.
      const panel = panelRef.current
      if (!panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null

    // Open with the filters wide again. A kind or date narrowing left over from the last
    // time would quietly hide records on the next search — which is precisely the failure
    // this feature exists to prevent. The query survives, selected, so typing replaces it.
    setFilters(DEFAULT_SEARCH_FILTERS)
    setSelected(0)
    setProblem(null)

    const id = window.setTimeout(() => inputRef.current?.select(), 0)
    return () => {
      window.clearTimeout(id)
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  /** A new result set means the old selection means nothing. */
  const flatKey = flat.map(hitKey).join('|')
  useEffect(() => {
    setSelected(0)
  }, [flatKey])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected, flatKey])

  const run = useCallback(
    (action: SearchAction): void => {
      if (action.type === 'navigate') {
        navigate(action.route)
        close()
        return
      }
      void (async () => {
        try {
          await openInObsidian(action.path)
          close()
        } catch (thrown) {
          setProblem(`${readableMessage(thrown)} The note is still at ${action.path}.`)
        }
      })()
    },
    [navigate, close]
  )

  const activate = useCallback(
    (hit: SearchHit, secondary = false): void => {
      const action = (secondary ? secondaryAction(hit) : null) ?? primaryAction(hit)
      run(action)
    },
    [run]
  )

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (flat.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) => (current + 1) % flat.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) => (current - 1 + flat.length) % flat.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSelected(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setSelected(flat.length - 1)
    } else if (event.key === 'Enter') {
      const hit = flat[selected]
      if (!hit) return
      event.preventDefault()
      activate(hit, event.metaKey || event.ctrlKey)
    }
  }

  if (!open) return null

  const selectedHit = flat[selected]
  const secondary = selectedHit ? secondaryAction(selectedHit) : null
  const trimmed = query.trim()

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[12vh] pb-10">
      <div className="bg-scrim absolute inset-0" onClick={close} aria-hidden />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="rounded-card bg-band border-line shadow-card relative flex max-h-full w-full max-w-[760px] flex-col overflow-hidden border"
      >
        <div className="border-line border-b px-6 py-4">
          <input
            ref={inputRef}
            value={query}
            autoFocus
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="desvu-search-results"
            aria-label="Search everything"
            placeholder="Search everything — including what has been set aside and finished"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            className="text-ink placeholder:text-muted w-full border-0 bg-transparent p-0 text-lg leading-relaxed focus:outline-none"
          />
        </div>

        {hits.length > 0 && (
          <div className="border-line flex items-start gap-3 border-b px-6 py-3">
            {/* The chips wrap; the date control keeps its corner rather than being
                carried along to the end of whichever row it lands on. */}
            <div
              role="group"
              aria-label="Filter by kind"
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            >
              <Button
                size="sm"
                shape="pill"
                variant={filters.kind === ALL_KINDS ? 'soft' : 'ghost'}
                aria-pressed={filters.kind === ALL_KINDS}
                onClick={() => setFilters((current) => ({ ...current, kind: ALL_KINDS }))}
              >
                Everything
                <span className="text-muted" data-numeric>
                  {hits.length}
                </span>
              </Button>
              {counts.map((entry) => (
                <Button
                  key={entry.kind}
                  size="sm"
                  shape="pill"
                  variant={filters.kind === entry.kind ? 'soft' : 'ghost'}
                  aria-pressed={filters.kind === entry.kind}
                  onClick={() => setFilters((current) => ({ ...current, kind: entry.kind }))}
                >
                  {KIND_LABEL[entry.kind]}
                  <span className="text-muted" data-numeric>
                    {entry.count}
                  </span>
                </Button>
              ))}
            </div>
            <Select
              aria-label="Date range"
              className="w-[150px] flex-none"
              value={filters.window}
              onChange={(event) =>
                setFilters((current) => ({ ...current, window: event.target.value as DateWindow }))
              }
            >
              {DATE_WINDOWS.map((window) => (
                <option key={window} value={window}>
                  {DATE_WINDOW_LABEL[window]}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div
          ref={listRef}
          id="desvu-search-results"
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        >
          {trimmed === '' && (
            <EmptyState compact title="Everything you have kept is in here.">
              Todos, journal entries, the library, brain dump threads, synthesis, meals
              and training — finished, set aside and dropped things included.
            </EmptyState>
          )}

          {trimmed !== '' && !search.settled && search.loading && (
            <div className="px-3 py-2">
              <SkeletonLines lines={3} />
            </div>
          )}

          {search.error && (
            <p className="text-muted px-3 py-2 text-sm">
              The vault couldn&apos;t be read just now. Nothing was changed — try again in a
              moment.
            </p>
          )}

          {trimmed !== '' && !search.error && search.settled && hits.length === 0 && (
            <EmptyState compact title={`Nothing matches “${trimmed}”.`}>
              Not a failure and not an error — just nothing by that name yet.
            </EmptyState>
          )}

          {trimmed !== '' && !search.error && hits.length > 0 && filtered.length === 0 && (
            <EmptyState compact title="Nothing matches within those filters.">
              {hits.length} {hits.length === 1 ? 'result is' : 'results are'} outside them.
            </EmptyState>
          )}

          {filtered.length > 0 && (
            <div className="flex flex-col gap-4">
              {groups.map((group) => {
                const offset = flat.indexOf(group.hits[0] as SearchHit)
                return (
                  <section key={group.kind} className="flex flex-col gap-1">
                    <Eyebrow className="px-3.5 pt-1 pb-1">
                      {group.label} · {group.hits.length}
                    </Eyebrow>
                    <ul className="flex flex-col gap-0.5">
                      {group.hits.map((hit, indexInGroup) => {
                        const index = offset + indexInGroup
                        return (
                          <SearchResultRow
                            key={hitKey(hit)}
                            hit={hit}
                            terms={terms}
                            selected={index === selected}
                            onActivate={() => activate(hit)}
                            onHover={() => setSelected(index)}
                          />
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-line text-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-6 py-3 text-xs">
          <span>
            {problem ? (
              <span className="text-accent-text">{problem}</span>
            ) : (
              <>
                ↑↓ to move · ↵ to open{secondary ? ` · ⌘↵ ${secondary.label.toLowerCase()}` : ''} ·
                Esc to close
              </>
            )}
          </span>
          <span>{OPEN_HINT} from anywhere</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
