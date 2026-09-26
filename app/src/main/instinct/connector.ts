import type { InstinctStatus } from '@shared/instinct'
import { resolveVaultPath } from '@shared/vault'
import { atomicWriteFile, readTextFileOrNull } from '../lib/atomic'
import { goalRepository } from '../repos/goalRepository'
import { inboxRepository } from '../repos/inboxRepository'
import { todoRepository } from '../repos/todoRepository'
import { contactKey, explicitRequest, importId, parseCommand, type Command } from './protocol'
import type { Message, Reader, Snapshot } from './reader'

interface Pending { guid: string; text: string; at: number }
interface State {
  version: 1; enabled: boolean; contact: string; snapshot: Snapshot | null; cursor: number
  vault: string; pending: Pending[]; activity: InstinctStatus['activity']; lastChecked: number | null
}
export const disconnectedStatus = (): InstinctStatus => ({ enabled: false, contact: '', connected: false, lastChecked: null, error: null, activity: [] })

export async function importCommand(command: Command, requestGuid: string, at: number): Promise<void> {
  const id = importId(requestGuid)
  if (command.kind === 'task') await todoRepository.create(command.input, id)
  else if (command.kind === 'goal') await goalRepository.create(command.input, id)
  else await inboxRepository.append(command.text, 'instinct', new Date(at), id)
}

function sameContact(value: string, contact: string): boolean {
  try { return contactKey(value) === contact } catch { return false }
}
function isSelectedMessage(message: Message, state: State): boolean {
  return Number.isSafeInteger(message.id) && message.id > state.cursor &&
    typeof message.guid === 'string' && message.guid.length > 0 && message.guid.length < 300 &&
    message.chat_id === state.snapshot?.chatId && message.chat_guid === state.snapshot.chatGuid &&
    message.is_group === false && Array.isArray(message.participants) && message.participants.length === 1 &&
    sameContact(message.participants[0]!, state.contact) &&
    typeof message.is_from_me === 'boolean' && (message.is_from_me || sameContact(message.sender, state.contact)) &&
    typeof message.text === 'string' && Number.isFinite(Date.parse(message.created_at))
}

export function createInstinctConnector(options: {
  statePath: string; reader: Reader
  import?: typeof importCommand
  vault?: () => string
}) {
  let state: State | null = null
  let error: string | null = null
  let connected = false
  let queue = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = true
  const vault = options.vault ?? resolveVaultPath
  const apply = options.import ?? importCommand

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn)
    queue = result.then(() => {}, () => {})
    return result
  }
  async function load(): Promise<State> {
    if (state) return state
    const raw = await readTextFileOrNull(options.statePath)
    if (raw !== null) {
      const saved = JSON.parse(raw) as State
      if (saved.version !== 1 || typeof saved.enabled !== 'boolean' || typeof saved.contact !== 'string' ||
        typeof saved.vault !== 'string' || !Number.isSafeInteger(saved.cursor) || saved.cursor < 0 ||
        !Array.isArray(saved.pending) || !Array.isArray(saved.activity)) throw new Error('Instinct settings are damaged. Restore the connection settings from backup.')
      state = saved
    } else state = { version: 1, enabled: false, contact: '', snapshot: null, cursor: 0, vault: vault(), pending: [], activity: [], lastChecked: null }
    return state
  }
  async function save(next: State): Promise<void> {
    await atomicWriteFile(options.statePath, JSON.stringify(next, null, 2) + '\n')
    state = next
  }
  async function status(): Promise<InstinctStatus> {
    const value = await load()
    return { enabled: value.enabled, contact: value.contact, connected, error,
      lastChecked: value.lastChecked, activity: structuredClone(value.activity) }
  }
  function notice(next: State, title: string): void {
    next.activity = [{ at: Date.now(), kind: 'notice' as const, title }, ...next.activity].slice(0, 30)
  }
  async function check(): Promise<InstinctStatus> {
    try {
      const current = await load()
      if (!current.enabled) return status()
      if (current.vault !== vault()) throw new Error('The vault location changed. Pause and reconnect Instinct to start importing into this vault.')
      const snapshot = await options.reader.snapshot(current.contact)
      if (!current.snapshot) {
        await save({ ...current, snapshot, cursor: snapshot.tail, pending: [], lastChecked: Date.now() })
      } else {
        if (snapshot.database !== current.snapshot.database || snapshot.chatGuid !== current.snapshot.chatGuid || snapshot.chatId !== current.snapshot.chatId || snapshot.tail < current.cursor) {
          const next = { ...current, enabled: false, snapshot: null, cursor: 0, pending: [] }
          notice(next, 'Messages database changed. Reconnect to start from the current conversation; older messages will be skipped.')
          await save(next)
          throw new Error('Messages database changed. Reconnect Instinct before importing more messages.')
        }
        // Bounded work per tick; the next tick resumes from the durable cursor.
        for (let count = 0; count < 10; count++) {
          const next = structuredClone(state!)
          const page = await options.reader.after(snapshot.chatId, next.cursor)
          if (page.has_more && page.next_rowid <= next.cursor) throw new Error('Messages reader did not advance. Try Check now again.')
          for (const message of page.messages) {
            if (!isSelectedMessage(message, next)) continue
            if (message.id > page.next_rowid) throw new Error('Messages reader returned an invalid cursor.')
            const at = Date.parse(message.created_at)
            if (message.is_from_me) {
              if (explicitRequest(message.text) && !next.pending.some((request) => request.guid === message.guid)) {
                next.pending.push({ guid: message.guid, text: message.text.trim(), at })
                if (next.pending.length > 100) {
                  next.pending.shift()
                  notice(next, 'An old unanswered request expired. Send it again if it is still needed.')
                }
              }
            } else {
              let command: Command | null
              try { command = parseCommand(message.text.trim()) } catch (failure) {
                notice(next, (failure as Error).message)
                continue
              }
              if (!command) continue
              // The most recent identical outstanding request wins; every request creates at most one item.
              const request = [...next.pending].reverse().find((item) => item.text === command!.request && at >= item.at && at - item.at <= 24 * 60 * 60 * 1000)
              if (!request) { notice(next, 'Ignored a reply without a matching unanswered Desvu: request from the last 24 hours.'); continue }
              // Stable request-derived ids live in the same atomic write as the new record.
              // If saving the cursor fails, replay reuses that record instead of duplicating it.
              await apply(command, request.guid, request.at)
              next.pending = next.pending.filter((item) => item.guid !== request.guid)
              next.activity = [{ at: Date.now(), kind: command.kind,
                title: command.kind === 'note' ? command.text : command.kind === 'task' ? command.input.text : command.input.title,
              }, ...next.activity].slice(0, 30)
            }
          }
          next.cursor = page.next_rowid
          next.lastChecked = Date.now()
          await save(next)
          if (!page.has_more) break
        }
      }
      connected = true
      error = null
    } catch (failure) { connected = false; error = (failure as Error).message }
    return status()
  }
  return {
    status: () => exclusive(status),
    check: () => exclusive(check),
    configure: (contact: string, enabled: boolean) => exclusive(async () => {
      if (typeof enabled !== 'boolean') throw new Error('Choose whether to enable the connection.')
      const key = contactKey(contact)
      const current = await load()
      // Resume the same chat from its cursor. A changed database requires an explicit fresh baseline.
      const reset = key !== current.contact || current.vault !== vault() || error?.includes('database changed')
      await save({ ...current, contact: key, enabled, vault: vault(),
        ...(reset ? { snapshot: null, cursor: 0, pending: [] } : {}) })
      connected = false
      error = null
      return enabled ? check() : status()
    }),
    start() {
      stopped = false
      const tick = (): void => {
        if (stopped) return
        void exclusive(check).catch(() => {}).finally(() => {
          if (!stopped) { timer = setTimeout(tick, 5000); timer.unref() }
        })
      }
      tick()
    },
    stop() { stopped = true; if (timer) clearTimeout(timer) },
  }
}
export type InstinctConnector = ReturnType<typeof createInstinctConnector>
