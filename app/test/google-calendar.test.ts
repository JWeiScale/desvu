import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { authorize, GOOGLE_SCOPES, googleEvent, listGoogleCalendars, listGoogleEvents, parseClient, type Fetcher } from '../src/main/google/client'
import { createCalendarSyncRepository } from '../src/main/repos/calendarSyncRepository'
import { calendarRepository } from '../src/main/repos/calendarRepository'
import { createTempVault, type TempVault } from './helpers/vault'

let vault: TempVault
beforeEach(async () => { vault = await createTempVault('google-calendar') })
afterEach(async () => { await vault.dispose() })
const client = { client_id: 'test.apps.googleusercontent.com', client_secret: 'desktop-test' }
const calendar = { id: 'primary', name: 'Personal', color: '#123456', primary: true, selected: true }
const event = { id: 'event', summary: 'Meeting', start: { dateTime: '2026-09-22T09:00:00-04:00' }, end: { dateTime: '2026-09-22T10:00:00-04:00' } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('Google event imports', () => {
  it('requires a desktop client and ignores endpoints supplied by the file', () => {
    expect(parseClient({ installed: { ...client, token_uri: 'https://unexpected.example' } })).toEqual(client)
    expect(() => parseClient({ web: client })).toThrow(/Desktop/)
  })

  it('namespaces duplicate event IDs and preserves free/all-day events', () => {
    const a = googleEvent(event, 'a@example.com', calendar)!
    expect(a).toMatchObject({ start: event.start.dateTime, calendar_id: 'primary', account_email: 'a@example.com', busy: true })
    expect(a.id).not.toBe(googleEvent(event, 'b@example.com', calendar)?.id)
    expect(a.id).not.toBe(googleEvent(event, 'a@example.com', { ...calendar, id: 'other' })?.id)
    expect(googleEvent({ ...event, transparency: 'transparent', start: { date: '2026-09-22' }, end: { date: '2026-09-23' } }, 'a@example.com', calendar))
      .toMatchObject({ busy: false, all_day: true, start: '2026-09-22', end: '2026-09-23' })
    expect(googleEvent({ ...event, status: 'cancelled' }, 'a@example.com', calendar)).toBeNull()
    expect(googleEvent({ ...event, attendees: [{ self: true, responseStatus: 'declined' }] }, 'a@example.com', calendar)).toBeNull()
  })

  it('paginates calendar lists and preserves selections', async () => {
    const urls: URL[] = []
    const fetcher: Fetcher = async (input) => {
      const url = new URL(String(input)); urls.push(url)
      return json(url.searchParams.has('pageToken') ? { items: [{ id: 'shared', summary: 'Team' }] }
        : { items: [{ id: 'primary', primary: true, summary: 'Main' }], nextPageToken: 'next' })
    }
    const result = await listGoogleCalendars(fetcher, 'access', [{ ...calendar, selected: false }])
    expect(result.map((c) => [c.id, c.selected])).toEqual([['primary', false], ['shared', false]])
    expect(urls[1]?.searchParams.get('pageToken')).toBe('next')
  })

  it('paginates recurring event instances with an exclusive end boundary', async () => {
    const urls: URL[] = []
    const fetcher: Fetcher = async (input) => {
      const url = new URL(String(input)); urls.push(url)
      return json(url.searchParams.has('pageToken') ? { items: [{ ...event, id: 'second' }] } : { items: [event], nextPageToken: 'next' })
    }
    expect(await listGoogleEvents(fetcher, 'access', 'a@example.com', calendar, '2026-09-22', '2026-09-23')).toHaveLength(2)
    expect(urls[0]?.searchParams.get('singleEvents')).toBe('true')
    expect(urls[0]?.searchParams.get('timeMax')).toBe(new Date('2026-09-24T00:00:00').toISOString())
    expect(urls[1]?.searchParams.get('pageToken')).toBe('next')
    await expect(listGoogleCalendars(async () => json({ nextPageToken: 'same' }), 'access')).rejects.toThrow(/repeated/)
  })
})

describe('multi-account sync', () => {
  async function setup(fetcher: Fetcher) {
    await vault.writeJson('.google-test/client.json', { installed: client })
    await vault.writeJson('.google-test/accounts.json', { accounts: ['a', 'b'].map((name) => ({ email: `${name}@example.com`, refresh_token: `encrypted:${name}`, calendars: [calendar], last_sync: null })) })
    return createCalendarSyncRepository('', { directory: vault.at('.google-test'), fetcher,
      decrypt: async (token) => token.replace('encrypted:', ''), encrypt: async (token) => `encrypted:${token}` })
  }

  it('keeps the failed account cache and out-of-range events while refreshing the other account', async () => {
    const oldA = googleEvent({ ...event, id: 'old-a' }, 'a@example.com', calendar)!
    const oldB = googleEvent({ ...event, id: 'old-b' }, 'b@example.com', calendar)!
    const outside = { ...oldA, id: 'outside', start: '2026-12-01T09:00:00-05:00', end: '2026-12-01T10:00:00-05:00' }
    await vault.writeJson('data/calendar.json', [oldA, oldB, outside])
    const repo = await setup(async (input, options) => {
      const url = String(input)
      if (url.includes('/token')) return String(options?.body).includes('refresh_token=b') ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'a-access' })
      if (url.includes('calendarList')) return json({ items: [{ id: 'primary', primary: true, summary: 'Personal' }] })
      return json({ items: [event] })
    })
    const result = await repo.refresh({ from: '2026-09-22', to: '2026-09-23' })
    expect(result).toMatchObject({ ok: true, events: 1 })
    expect(result.warnings?.[0]).toContain('b@example.com')
    const ids = (await calendarRepository.listAll()).map((e) => e.id)
    expect(ids).toContain(oldB.id); expect(ids).toContain(outside.id); expect(ids).not.toContain(oldA.id)
    const status = await repo.status()
    expect(status.accounts?.[1]?.error).toMatch(/Reconnect/)
    expect(JSON.stringify(status)).not.toContain('encrypted:')
    expect(JSON.stringify(status)).not.toContain('refresh_token')
    expect(await readFile(vault.at('.google-test/accounts.json'), 'utf8')).toContain('encrypted:a')
    await repo.selectCalendars('a@example.com', [])
    expect((await calendarRepository.listAll()).map((e) => e.id)).toEqual([oldB.id])
    await repo.disconnect('b@example.com')
    expect(await calendarRepository.listAll()).toEqual([])
    expect((await repo.status()).accounts).toHaveLength(1)
  })

  it('does not contact Google before configuration and rejects invalid ranges', async () => {
    const repo = createCalendarSyncRepository('', { directory: vault.at('.google-test'), fetcher: async () => { throw new Error('Unexpected request') } })
    expect(await repo.refresh()).toMatchObject({ ok: false, events: 0 })
    await expect(repo.refresh({ from: '2026-09-22', to: '2028-01-01' })).rejects.toThrow()
  })
})

describe('desktop OAuth', () => {
  it('connects an account and persists only the encrypted refresh token', async () => {
    await vault.writeJson('.google-test/client.json', { installed: client })
    const repo = createCalendarSyncRepository('', {
      directory: vault.at('.google-test'), encrypt: async () => 'encrypted-token', decrypt: async () => 'offline-token',
      openBrowser: async (url) => {
        const auth = new URL(url), callback = new URL(auth.searchParams.get('redirect_uri')!)
        callback.searchParams.set('state', auth.searchParams.get('state')!); callback.searchParams.set('code', 'auth-code')
        await fetch(callback)
      },
      fetcher: async (input) => {
        const url = String(input)
        if (url.includes('/token')) return json({ access_token: 'transient-access', refresh_token: 'offline-token', scope: GOOGLE_SCOPES.join(' ') })
        if (url.includes('/userinfo')) return json({ email: 'a@example.com', verified_email: true })
        return json({ items: [{ id: 'primary', primary: true, summary: 'Personal' }] })
      },
    })
    const status = await repo.connect('a@example.com')
    expect(status.accounts?.[0]).toMatchObject({ email: 'a@example.com', connected: true })
    const persisted = await readFile(vault.at('.google-test/accounts.json'), 'utf8')
    expect(persisted).toContain('encrypted-token')
    expect(persisted).not.toContain('offline-token')
    expect(persisted).not.toContain('transient-access')
    expect(JSON.stringify(status)).not.toContain('encrypted-token')
  })

  it('requires matching state and uses a PKCE verifier plus read-only calendar scopes', async () => {
    let authUrl!: URL
    const result = await authorize(client, 'a@example.com', async (url) => {
      authUrl = new URL(url)
      const callback = new URL(authUrl.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', 'wrong'); callback.searchParams.set('code', 'example-code')
      expect((await fetch(callback)).status).toBe(400)
      callback.searchParams.set('state', authUrl.searchParams.get('state')!)
      expect((await fetch(callback)).status).toBe(200)
    }, new AbortController().signal)
    expect(result.code).toBe('example-code')
    expect(authUrl.searchParams.get('code_challenge')).toBe(createHash('sha256').update(result.verifier).digest('base64url'))
    expect(authUrl.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '))
    expect(authUrl.searchParams.get('login_hint')).toBe('a@example.com')
  })

  it('cancels a pending browser sign-in', async () => {
    const abort = new AbortController()
    await expect(authorize(client, undefined, async () => { abort.abort() }, abort.signal)).rejects.toThrow(/cancelled/)
  })
})
