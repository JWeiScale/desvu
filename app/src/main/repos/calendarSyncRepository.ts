import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { CalendarStatus, CalendarRefreshResult, GoogleAccount, GoogleCalendar } from '@shared/types'
import { localDay, shiftDay } from '@shared/scheduling'
import { resolveVaultPath } from '@shared/vault'
import { calendarRepository, validateCalendarRange } from './calendarRepository'
import { authorize, GOOGLE_SCOPES, googleJson, listGoogleCalendars, listGoogleEvents, parseClient, TOKEN_URL, type Fetcher, type OAuthClient } from '../google/client'

interface StoredAccount { email: string; refresh_token?: string; calendars: GoogleCalendar[]; last_sync: number | null; error?: string }
interface StoredState { accounts: StoredAccount[] }
interface Options {
  directory?: string
  fetcher?: Fetcher
  encrypt?: (value: string) => Promise<string>
  decrypt?: (value: string) => Promise<string>
  openBrowser?: (url: string) => Promise<void>
}

/** Tokens remain outside the vault, encrypted by macOS Keychain through safeStorage. */
export function createCalendarSyncRepository(_appRoot: string, options: Options = {}) {
  const directory = () => options.directory ?? (process.env.VITEST
    ? path.join(resolveVaultPath(), '.google-test')
    : path.join(homedir(), 'Library', 'Application Support', 'Dès vu', 'google-calendar'))
  const file = (name: string) => path.join(directory(), name)
  const fetcher = options.fetcher ?? fetch
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => {})
    return next
  }
  let connecting: AbortController | null = null
  const encrypt = options.encrypt ?? (async (value: string) => {
    const { safeStorage } = await import('electron')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable. Unlock your login Keychain and try again.')
    return safeStorage.encryptString(value).toString('base64')
  })
  const decrypt = options.decrypt ?? (async (value: string) => {
    const { safeStorage } = await import('electron')
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  })
  const openBrowser = options.openBrowser ?? (async (url: string) => { const { shell } = await import('electron'); await shell.openExternal(url) })
  async function readState(): Promise<StoredState> {
    try { return JSON.parse(await readFile(file('accounts.json'), 'utf8')) as StoredState }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { accounts: [] }; throw error }
  }
  async function save(name: string, value: unknown): Promise<void> {
    await mkdir(directory(), { recursive: true, mode: 0o700 })
    const target = file(name), temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await rename(temp, target)
    await chmod(target, 0o600)
  }
  async function readClient(): Promise<OAuthClient | null> {
    try { return parseClient(JSON.parse(await readFile(file('client.json'), 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  async function accessToken(account: StoredAccount, client: OAuthClient): Promise<string> {
    if (!account.refresh_token) throw new Error('Connect this Google account first.')
    const body = await googleJson(fetcher, TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...client, refresh_token: await decrypt(account.refresh_token), grant_type: 'refresh_token' }),
    })
    if (typeof body.access_token !== 'string') throw new Error('Google did not return an access token. Reconnect the account.')
    return body.access_token
  }
  async function status(): Promise<CalendarStatus> {
    const state = await readState()
    const accounts: GoogleAccount[] = state.accounts.map(({ email, refresh_token, calendars, last_sync, error }) => ({
      email, connected: Boolean(refresh_token), calendars, last_sync, ...(error ? { error } : {}),
    }))
    return { configured: Boolean(await readClient()), connected: accounts.some((a) => a.connected), accounts,
      last_refresh: await calendarRepository.lastRefresh() }
  }
  return {
    status,
    async configure(): Promise<{ configured: boolean }> {
      const { dialog } = await import('electron')
      const chosen = await dialog.showOpenDialog({ title: 'Import Google Desktop OAuth credentials', properties: ['openFile'], filters: [{ name: 'Google credentials', extensions: ['json'] }] })
      if (chosen.canceled || !chosen.filePaths[0]) return { configured: Boolean(await readClient()) }
      const client = parseClient(JSON.parse(await readFile(chosen.filePaths[0], 'utf8')))
      return serial(async () => {
        const old = await readClient()
        const state = await readState()
        if (old && old.client_id !== client.client_id && state.accounts.some((a) => a.refresh_token)) {
          throw new Error('Disconnect existing Google accounts before changing the OAuth client.')
        }
        await save('client.json', { installed: client })
        return { configured: true }
      })
    },
    async openSetup(): Promise<void> { await openBrowser('https://console.cloud.google.com/apis/credentials') },
    async connect(email?: string): Promise<CalendarStatus> {
      if (connecting) throw new Error('Finish the current Google sign-in first.')
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid Google account email.')
      const abort = new AbortController()
      connecting = abort
      try {
        const client = await readClient()
        if (!client) throw new Error('Import Google Desktop OAuth credentials first.')
        const { code, verifier, redirect } = await authorize(client, email, openBrowser, abort.signal)
        const token = await googleJson(fetcher, TOKEN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ ...client, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
        })
        const granted = new Set(String(token.scope ?? '').split(' '))
        if (!GOOGLE_SCOPES.filter((scope) => scope.includes('/calendar.')).every((scope) => granted.has(scope))) {
          throw new Error('Approve both calendar permissions so Dès vu can show your calendars and events.')
        }
        const user = await googleJson(fetcher, 'https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } })
        if (typeof user.email !== 'string' || !user.verified_email) throw new Error('Google did not return a verified email address.')
        if (email && user.email.toLowerCase() !== email.toLowerCase()) throw new Error(`You signed into ${user.email}. Connect again and choose ${email}.`)
        if (!token.refresh_token) throw new Error('Google did not grant offline access. Reconnect and approve access again.')
        const calendars = await listGoogleCalendars(fetcher, token.access_token)
        if (abort.signal.aborted) throw new Error('Calendar connection cancelled.')
        await serial(async () => {
          const state = await readState()
          const previous = state.accounts.find((a) => a.email.toLowerCase() === user.email.toLowerCase())
          if (previous) for (const calendar of calendars) calendar.selected = previous.calendars.find((c) => c.id === calendar.id)?.selected ?? calendar.selected
          const account: StoredAccount = { email: user.email, refresh_token: await encrypt(token.refresh_token), calendars, last_sync: previous?.last_sync ?? null }
          if (abort.signal.aborted) throw new Error('Calendar connection cancelled.')
          state.accounts = [...state.accounts.filter((a) => a.email.toLowerCase() !== user.email.toLowerCase()), account]
          await save('accounts.json', state)
        })
        return status()
      } finally { connecting = null }
    },
    async cancelConnect(): Promise<void> { connecting?.abort() },
    async disconnect(email: string): Promise<void> {
      return serial(async () => {
        const state = await readState()
        state.accounts = state.accounts.filter((account) => account.email !== email)
        await save('accounts.json', state)
        await calendarRepository.replaceAccountEvents(email, [])
      })
    },
    async calendars(email: string): Promise<GoogleCalendar[]> {
      return serial(async () => {
        const state = await readState(), client = await readClient()
        const account = state.accounts.find((a) => a.email === email)
        if (!account || !client) throw new Error('Connect this Google account first.')
        account.calendars = await listGoogleCalendars(fetcher, await accessToken(account, client), account.calendars)
        await save('accounts.json', state)
        return account.calendars
      })
    },
    async selectCalendars(email: string, ids: string[]): Promise<void> {
      return serial(async () => {
        const state = await readState()
        const account = state.accounts.find((a) => a.email === email)
        if (!account) throw new Error('Connect this Google account first.')
        if (!Array.isArray(ids) || ids.some((id) => !account.calendars.some((c) => c.id === id))) throw new Error('Choose calendars belonging to this account.')
        account.calendars.forEach((calendar) => { calendar.selected = ids.includes(calendar.id) })
        await save('accounts.json', state)
        const events = (await calendarRepository.listAll()).filter((e) => e.account_email === email && ids.includes(e.calendar_id ?? ''))
        await calendarRepository.replaceAccountEvents(email, events)
      })
    },
    async refresh(range?: { from: string; to: string }): Promise<CalendarRefreshResult> {
      const today = localDay(new Date())
      const { from, to } = range ?? { from: shiftDay(today, -30), to: shiftDay(today, 90) }
      validateCalendarRange(from, to)
      return serial(async () => {
        const client = await readClient(), state = await readState()
        if (!client || !state.accounts.some((a) => a.refresh_token)) return { ok: false, events: 0, error: 'Connect a Google account to sync its calendars.' }
        const warnings: string[] = []
        let count = 0, successes = 0
        for (const account of state.accounts.filter((a) => a.refresh_token)) {
          try {
            const token = await accessToken(account, client)
            account.calendars = await listGoogleCalendars(fetcher, token, account.calendars)
            const events = []
            for (const calendar of account.calendars.filter((c) => c.selected)) {
              events.push(...await listGoogleEvents(fetcher, token, account.email, calendar, from, to))
            }
            await calendarRepository.replaceAccountEvents(account.email, events, from, to)
            account.last_sync = Date.now(); delete account.error
            count += events.length; successes += 1
          } catch (error) {
            account.error = error instanceof Error ? error.message : 'Google Calendar could not sync.'
            warnings.push(`${account.email}: ${account.error}`)
          }
        }
        await save('accounts.json', state)
        return { ok: successes > 0, events: count, ...(warnings.length ? { warnings, error: warnings.join('\n') } : {}) }
      })
    },
  }
}
export type CalendarSyncRepository = ReturnType<typeof createCalendarSyncRepository>
