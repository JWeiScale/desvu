import type { IpcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  callChannel,
  ipcHandlers,
  registerIpcHandlers,
  unregisterIpcHandlers,
} from '../src/main/ipc-router'
import { setExternalOpener } from '../src/main/repos/systemRepository'
import { createTempVault, dayOffset, type TempVault } from './helpers/vault'

let vault: TempVault

beforeEach(async () => {
  vault = await createTempVault('ipc')
  setExternalOpener(async () => undefined)
})

afterEach(async () => {
  await vault.dispose()
})

/** Minimal stand-in for Electron's `ipcMain`. */
function fakeIpcMain(): {
  ipcMain: IpcMain
  registered: Map<string, (...args: unknown[]) => unknown>
} {
  const registered = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle(channel: string, listener: (...args: unknown[]) => unknown) {
      if (registered.has(channel)) throw new Error(`duplicate handler for ${channel}`)
      registered.set(channel, listener)
    },
    removeHandler(channel: string) {
      registered.delete(channel)
    },
  } as unknown as IpcMain

  return { ipcMain, registered }
}

describe('IPC parity', () => {
  it('has exactly one handler per channel and no handler without a channel', () => {
    const channels = [...IPC_CHANNELS].sort()
    const handlers = Object.keys(ipcHandlers).sort()

    expect(handlers).toEqual(channels)

    const missing = channels.filter((channel) => !handlers.includes(channel))
    const extra = handlers.filter((handler) => !channels.includes(handler as never))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it('exposes only functions as handlers', () => {
    for (const [channel, handler] of Object.entries(ipcHandlers)) {
      expect(typeof handler, `${channel} must be a function`).toBe('function')
    }
  })

  it('has no duplicate channel names in the allowlist', () => {
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length)
  })

  it('names every channel `<domain>:<method>`', () => {
    for (const channel of IPC_CHANNELS) {
      expect(channel, channel).toMatch(/^[a-zA-Z]+:[a-zA-Z]+$/)
    }
  })

  it('registers every channel with ipcMain exactly once, and removes them all again', () => {
    const { ipcMain, registered } = fakeIpcMain()

    registerIpcHandlers(ipcMain)
    expect([...registered.keys()].sort()).toEqual([...IPC_CHANNELS].sort())

    unregisterIpcHandlers(ipcMain)
    expect(registered.size).toBe(0)
  })
})

describe('every channel actually runs against an empty vault', () => {
  /** One representative call per channel, chosen to be side-effect-light. */
  const calls: Record<string, unknown[]> = {
    'todos:list': [],
    'todos:listTemplates': [],
    'todos:forDate': [dayOffset(0)],
    'todos:create': [{ text: 'a todo from ipc' }],
    'todos:update': ['__id__', { priority: 1 }],
    'todos:complete': ['__id__', 15],
    'todos:reopen': ['__id__'],
    'todos:remove': ['__id__'],
    'todos:dayLoad': [dayOffset(0)],
    'todos:correctionFactors': [],

    'journal:list': [],
    'journal:byDate': [dayOffset(0)],
    'journal:upsert': [{ entry_date: dayOffset(0), rating: 4 }],
    'journal:remove': ['__journal__'],
    'journal:streak': [],

    'finance:list': [],
    'finance:create': [
      { date: dayOffset(0), amount: 5, category: 'food', description: 'x', source: 'app' },
    ],
    'finance:update': ['__purchase__', { amount: 6 }],
    'finance:remove': ['__purchase__'],
    'finance:monthSummary': [dayOffset(0).slice(0, 7)],

    'meals:list': [],
    'meals:forDate': [dayOffset(0)],
    'meals:create': [
      {
        date: dayOffset(0),
        meal: 'lunch',
        description: 'x',
        calories: null,
        protein_g: null,
        estimated: false,
        source: 'app',
      },
    ],
    'meals:update': ['__meal__', { calories: 100 }],
    'meals:remove': ['__meal__'],

    'workouts:list': [],
    'workouts:forDate': [dayOffset(0)],
    'workouts:create': [
      { date: dayOffset(0), type: 'run', description: 'x', duration_minutes: 20, source: 'app' },
    ],
    'workouts:update': ['__workout__', { duration_minutes: 25 }],
    'workouts:remove': ['__workout__'],

    'library:list': [],
    'library:create': [{ title: 'an article from ipc' }],
    'library:setStatus': ['__library__', 'reading'],
    'library:setArchived': ['__library__', true],
    'library:fitting': [40],
    'library:runAutoArchive': [],

    'brainDump:listThreads': [],
    'brainDump:readThread': ['__thread__'],
    'brainDump:appendToThread': ['__thread__', 'another thought'],
    'brainDump:createThread': ['Ideas', 'From IPC', 'the first thought'],
    'brainDump:listTopics': [],

    'synthesis:list': [],
    // A week that has never been written — `read` returns null rather than throwing.
    'synthesis:read': ['2026-W31'],

    'inbox:read': [],
    'inbox:count': [],
    // `sort` spawns the Claude CLI and costs real money, so the contract test exercises
    // the dry-run path only. `sortAvailable` and `cancelSort` are safe unconditionally —
    // cancelling with nothing running is a no-op by design.
    'inbox:sort': [{ dryRun: true }],
    'inbox:cancelSort': [],
    'inbox:sortAvailable': [],

    'calendar:forDate': [dayOffset(0)],
    'calendar:forRange': [dayOffset(0), dayOffset(7)],
    'calendar:status': [],
    'calendar:configure': [],
    'calendar:openSetup': [],
    'calendar:connect': ['person@example.com'],
    'calendar:cancelConnect': [],
    'calendar:disconnect': ['person@example.com'],
    'calendar:calendars': ['person@example.com'],
    'calendar:selectCalendars': ['person@example.com', []],
    // Tests use an isolated, unconfigured directory and never contact Google.
    'calendar:refresh': [],
    'calendar:lastRefresh': [],

    'settings:get': [],
    'settings:update': [{ nutrition: { calorie_target: 2200 } }],

    'search:query': ['ipc'],

    'system:vaultPath': [],
    'system:openInObsidian': ['Library/anything.md'],
    'system:quickCapture': ['captured through ipc'],
  }

  it('covers every channel in the allowlist', () => {
    expect(Object.keys(calls).sort()).toEqual([...IPC_CHANNELS].sort())
  })

  it('resolves for every channel, with real ids substituted where one is needed', async () => {
    // Seed the records the id-taking channels operate on.
    const todo = (await callChannel('todos:create', { text: 'seed todo' })) as { id: string }
    const secondTodo = (await callChannel('todos:create', { text: 'seed todo 2' })) as {
      id: string
    }
    const thirdTodo = (await callChannel('todos:create', { text: 'seed todo 3' })) as {
      id: string
    }
    const journal = (await callChannel('journal:upsert', {
      entry_date: dayOffset(-1),
      rating: 5,
    })) as { id: string }
    const purchase = (await callChannel('finance:create', {
      date: dayOffset(0),
      amount: 9,
      category: 'food',
      description: 'seed',
      source: 'app',
    })) as { id: string }
    const meal = (await callChannel('meals:create', {
      date: dayOffset(0),
      meal: 'dinner',
      description: 'seed',
      calories: null,
      protein_g: null,
      estimated: false,
      source: 'app',
    })) as { id: string }
    const workout = (await callChannel('workouts:create', {
      date: dayOffset(0),
      type: 'lift',
      description: 'seed',
      duration_minutes: 30,
      source: 'app',
    })) as { id: string }
    const item = (await callChannel('library:create', { title: 'seed article' })) as {
      path: string
    }
    const thread = (await callChannel('brainDump:createThread', 'Seed', 'Seed thread', 'x')) as {
      path: string
    }

    const substitutions: Record<string, string> = {
      __id__: todo.id,
      __journal__: journal.id,
      __purchase__: purchase.id,
      __meal__: meal.id,
      __workout__: workout.id,
      __library__: item.path,
      __thread__: thread.path,
    }
    const perChannelId: Record<string, string> = {
      'todos:complete': secondTodo.id,
      'todos:remove': thirdTodo.id,
    }

    /**
     * `inbox:sort` spawns the Claude CLI, which takes 40–115 seconds and bills real
     * tokens. Invoking it here would put a minute and a dollar on every `vitest run`.
     * It stays in `calls` so the coverage test still forces anyone adding a channel to
     * think about it; only the invocation is skipped, and only for this reason.
     */
    // Interactive handlers require Electron/user consent. Account-dependent handlers
    // have integration coverage with injected Google responses in google-calendar.test.
    const INTERACTIVE_OR_EXTERNAL = new Set(['inbox:sort', 'calendar:configure',
      'calendar:openSetup', 'calendar:connect', 'calendar:calendars', 'calendar:selectCalendars'])

    for (const channel of IPC_CHANNELS) {
      if (INTERACTIVE_OR_EXTERNAL.has(channel)) continue
      const args = (calls[channel] ?? []).map((arg) => {
        if (typeof arg !== 'string') return arg
        if (arg === '__id__' && perChannelId[channel]) return perChannelId[channel]
        return substitutions[arg] ?? arg
      })

      await expect(
        callChannel(channel, ...args),
        `${channel} should resolve`
      ).resolves.not.toThrow()
    }
  })

  it('keeps todos:list and todos:listTemplates disjoint across the IPC boundary', async () => {
    await callChannel('todos:create', {
      text: 'gym',
      recurrence: { type: 'daily', interval: 1 },
    })
    await callChannel('todos:create', { text: 'a one-off', due: dayOffset(0) })
    await callChannel('todos:forDate', dayOffset(0))

    const list = (await callChannel('todos:list')) as { id: string; recurrence: unknown }[]
    const templates = (await callChannel('todos:listTemplates')) as {
      id: string
      recurrence: unknown
    }[]

    expect(templates).toHaveLength(1)
    expect(list.every((todo) => todo.recurrence === null)).toBe(true)
    expect(templates.every((todo) => todo.recurrence !== null)).toBe(true)

    const listIds = new Set(list.map((todo) => todo.id))
    expect(templates.some((todo) => listIds.has(todo.id))).toBe(false)
  })

  it('re-throws repository errors as plain messages the renderer can show', async () => {
    await expect(callChannel('journal:upsert', { entry_date: dayOffset(0), rating: 9 })).rejects
      .toThrow(/rating must be from 1 to 7/)
    await expect(callChannel('todos:update', 'missing', { priority: 1 })).rejects.toThrow(
      /No todo with id missing/
    )
  })
})
