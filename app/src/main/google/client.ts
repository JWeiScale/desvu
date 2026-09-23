import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CalendarEvent, GoogleCalendar } from '@shared/types'
import { shiftDay } from '@shared/scheduling'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export interface OAuthClient { client_id: string; client_secret?: string }
export type Fetcher = typeof fetch

type Json = Record<string, any>
export async function googleJson(fetcher: Fetcher, url: string | URL, options: RequestInit = {}): Promise<Json> {
  const response = await fetcher(url, { ...options, signal: options.signal ?? AbortSignal.timeout(30_000) })
  const body = await response.json() as Json
  if (!response.ok) {
    const error = typeof body.error === 'string' ? body.error : body.error?.message
    if (error === 'invalid_grant' || response.status === 401) throw new Error('Google access expired or was revoked. Reconnect this account.')
    throw new Error(`Google could not complete the request (${response.status}): ${error || 'please try again'}`)
  }
  return body
}

export function parseClient(value: unknown): OAuthClient {
  const client = (value as { installed?: OAuthClient })?.installed
  if (!client || typeof client.client_id !== 'string' || !client.client_id.endsWith('.apps.googleusercontent.com')) {
    throw new Error('Choose the JSON downloaded for a Google OAuth client of type Desktop app.')
  }
  return { client_id: client.client_id, ...(typeof client.client_secret === 'string' ? { client_secret: client.client_secret } : {}) }
}

export async function authorize(client: OAuthClient, email: string | undefined, openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<{ code: string; verifier: string; redirect: string }> {
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  let succeed!: (code: string) => void
  let fail!: (error: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => { succeed = resolve; fail = reject })
  // Prevent an unhandled rejection if cancellation occurs while the browser is opening.
  void codePromise.catch(() => {})
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404); res.end(); return }
    if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end('Invalid sign-in state. Return to Desvu and try again.'); return }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.has('error')) {
      res.end('<h1>Calendar connection cancelled</h1><p>You can close this tab and return to Dès vu.</p>')
      fail(new Error('Google Calendar access was not approved. You can connect again whenever you are ready.'))
    } else {
      res.end('<h1>Return to Dès vu</h1><p>Your sign-in is being completed. You can close this tab.</p>')
      succeed(code)
    }
  })
  const cancel = () => fail(new Error('Calendar connection cancelled.'))
  const timer = setTimeout(() => fail(new Error('Google sign-in timed out. Choose Connect to try again.')), 5 * 60_000)
  timer.unref()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    if (signal.aborted) throw new Error('Calendar connection cancelled.')
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    for (const [key, value] of Object.entries({
      client_id: client.client_id, redirect_uri: redirect, response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account',
      state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    })) url.searchParams.set(key, value)
    if (email) url.searchParams.set('login_hint', email)
    await openBrowser(url.toString())
    return { code: await codePromise, verifier, redirect }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    server.closeAllConnections()
    server.close()
  }
}

export async function listGoogleCalendars(fetcher: Fetcher, token: string, existing: GoogleCalendar[] = []): Promise<GoogleCalendar[]> {
  const calendars: GoogleCalendar[] = []
  let page: string | undefined
  const seen = new Set<string>()
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
    url.searchParams.set('maxResults', '250')
    if (page) url.searchParams.set('pageToken', page)
    const body = await googleJson(fetcher, url, { headers: { Authorization: `Bearer ${token}` } })
    for (const item of body.items ?? []) {
      if (!item.id || item.deleted) continue
      const previous = existing.find((c) => c.id === item.id)
      calendars.push({ id: item.id, name: item.summaryOverride || item.summary || item.id,
        color: /^#[0-9a-f]{6}$/i.test(item.backgroundColor ?? '') ? item.backgroundColor : '#7b8b76',
        primary: item.primary === true, selected: previous?.selected ?? item.primary === true })
    }
    page = body.nextPageToken
    if (page && seen.has(page)) throw new Error('Google returned a repeated calendar page. Please sync again.')
    if (page) seen.add(page)
  } while (page)
  return calendars
}

export function googleEvent(item: Json, email: string, calendar: GoogleCalendar): CalendarEvent | null {
  if (item.status === 'cancelled' || (item.attendees ?? []).some((a: Json) => a.self && a.responseStatus === 'declined')) return null
  const start = item.start?.dateTime ?? item.start?.date
  const end = item.end?.dateTime ?? item.end?.date
  if (typeof item.id !== 'string' || typeof start !== 'string' || typeof end !== 'string' || !(Date.parse(end) > Date.parse(start))) return null
  return {
    id: `${email}:${calendar.id}:${item.id}`, title: item.summary?.trim() || '(No title)',
    start, end, all_day: Boolean(item.start?.date), busy: item.transparency !== 'transparent',
    account_email: email, calendar_id: calendar.id, calendar_name: calendar.name, color: calendar.color,
    ...(typeof item.location === 'string' ? { location: item.location } : {}),
  }
}

export async function listGoogleEvents(fetcher: Fetcher, token: string, email: string, calendar: GoogleCalendar, from: string, to: string): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = []
  let page: string | undefined
  const seen = new Set<string>()
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`)
    for (const [key, value] of Object.entries({
      timeMin: new Date(`${from}T00:00:00`).toISOString(), timeMax: new Date(`${shiftDay(to, 1)}T00:00:00`).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
    })) url.searchParams.set(key, value)
    if (page) url.searchParams.set('pageToken', page)
    const body = await googleJson(fetcher, url, { headers: { Authorization: `Bearer ${token}` } })
    for (const item of body.items ?? []) { const event = googleEvent(item, email, calendar); if (event) events.push(event) }
    page = body.nextPageToken
    if (page && seen.has(page)) throw new Error('Google returned a repeated event page. Please sync again.')
    if (page) seen.add(page)
  } while (page)
  return events
}
