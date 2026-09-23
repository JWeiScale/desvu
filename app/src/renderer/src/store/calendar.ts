import { useEffect } from 'react'
import { create } from 'zustand'
import type { CalendarEvent, CalendarRefreshResult, CalendarStatus, DateString } from '@shared/types'
import { bridge } from '@/lib/bridge'
import { useVaultQuery, type VaultQuery } from './useVaultQuery'
import { invalidateVault } from './vault'

export function useCalendarForDate(date: DateString): VaultQuery<CalendarEvent[]> {
  return useVaultQuery(() => bridge().calendar.forDate(date), [date])
}
export function useCalendarRange(from: DateString, to: DateString): VaultQuery<CalendarEvent[]> {
  return useVaultQuery(() => bridge().calendar.forRange(from, to), [from, to])
}

type Range = { from: string; to: string }
interface SyncState {
  status: CalendarStatus | null
  refreshing: boolean
  lastResult: CalendarRefreshResult | null
  refresh: (range?: Range) => Promise<void>
  readStatus: () => Promise<void>
  dismiss: () => void
}
let running: Promise<void> | null = null
let runningKey = ''
let currentRange: Range | undefined
export function clearCalendarRange(): void { currentRange = undefined }
const useSync = create<SyncState>((set, get) => ({
  status: null, refreshing: false, lastResult: null,
  readStatus: async () => {
    try { set({ status: await bridge().calendar.status() }) }
    catch (error) { set({ lastResult: { ok: false, events: 0, error: String(error) } }) }
  },
  refresh: async (range) => {
    const key = JSON.stringify(range ?? currentRange ?? {})
    if (running) {
      await running
      if (key !== runningKey) return get().refresh(range)
      return
    }
    if (range) currentRange = range
    runningKey = key
    running = (async () => {
      set({ refreshing: true, lastResult: null })
      try {
        const result = await bridge().calendar.refresh(currentRange)
        set({ lastResult: result }); invalidateVault()
        await get().readStatus()
      } catch (error) { set({ lastResult: { ok: false, events: 0, error: error instanceof Error ? error.message : String(error) } }) }
      finally { set({ refreshing: false }) }
    })()
    try { await running } finally { running = null }
  },
  dismiss: () => set({ lastResult: null }),
}))
let users = 0
let timer: ReturnType<typeof setInterval> | null = null
export function useCalendarSync(): SyncState {
  const state = useSync()
  useEffect(() => {
    users += 1
    if (!timer) {
      const tick = async () => {
        await useSync.getState().readStatus()
        if (useSync.getState().status?.connected) await useSync.getState().refresh()
      }
      void tick()
      timer = setInterval(() => void tick(), 5 * 60_000)
    }
    return () => { users -= 1; if (!users && timer) { clearInterval(timer); timer = null } }
  }, [])
  return state
}
export function describeLastRefresh(at: number | null): string | null {
  if (at === null) return null
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}
