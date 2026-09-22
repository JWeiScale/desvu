import { useEffect, useState } from 'react'
import type { SearchHit } from '@shared/types'

import { bridge } from '@/lib/bridge'
import { useVaultQuery, type VaultQuery } from '@/store/useVaultQuery'

/**
 * Typing is fast and the repository walks the whole corpus on every call, so the query is
 * held for a beat before it crosses IPC. `useVaultQuery` discards out-of-order responses,
 * so a slow scan can never overwrite a newer one.
 */
const DEBOUNCE_MS = 120

export function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])

  return settled
}

/**
 * PRD S1–S3. One input over todos, journal, library, brain dump, synthesis, meals,
 * and training — including the archived library items and the completed and
 * dropped todos that the default views hide.
 *
 * An empty query is not a search: it returns nothing without crossing IPC, so opening the
 * overlay does not scan the vault.
 */
export function useSearch(query: string): VaultQuery<SearchHit[]> {
  const debounced = useDebounced(query)
  const trimmed = debounced.trim()

  return useVaultQuery(
    async () => (trimmed === '' ? [] : bridge().search.query(trimmed)),
    [trimmed]
  )
}

export async function openInObsidian(path: string): Promise<void> {
  await bridge().system.openInObsidian(path)
}
