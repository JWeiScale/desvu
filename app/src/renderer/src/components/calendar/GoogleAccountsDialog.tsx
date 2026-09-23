import { useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { bridge } from '@/lib/bridge'
import { useCalendarSync, describeLastRefresh } from '@/store/calendar'
import { invalidateVault } from '@/store/vault'

export function GoogleAccountsDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { status, readStatus, refresh } = useCalendarSync()
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const run = async (label: string, action: () => Promise<unknown>, sync = false) => {
    setBusy(label); setError('')
    try { await action(); await readStatus(); invalidateVault(); if (sync) await refresh() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  const connect = (address?: string) => run('Connecting', async () => { await bridge().calendar.connect(address); setEmail('') }, true)
  return <Dialog open={open} onClose={onClose} title="Google calendars" size="lg" className="max-h-[76vh] overflow-y-auto"
    description="Bring your personal, school, and work calendars together. Events are imported read-only; tasks stay in Dès vu."
    footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
    {!status?.configured && <div className="rounded-card border border-line bg-card p-4 text-sm">
      <p className="mb-2 font-medium">One-time Google setup</p>
      <ol className="list-decimal space-y-1 pl-5 text-ink2">
        <li>In Google Cloud, select or create a project and enable the Google Calendar API.</li>
        <li>Set up Google Auth Platform with an External audience. If the app is in Testing, add each Google account as a test user.</li>
        <li>Create an OAuth client with application type <strong>Desktop app</strong>, download its JSON file, and import it here.</li>
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void run('Opening setup', () => bridge().calendar.openSetup())}>Open Google Cloud</Button>
        <Button variant="primary" size="sm" disabled={Boolean(busy)} onClick={() => void run('Importing credentials', () => bridge().calendar.configure())}>Import credentials JSON</Button>
      </div>
    </div>}
    {(status?.accounts ?? []).map((account) => <div key={account.email} className="rounded-card border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium">{account.email}</p><p className="text-muted text-xs">{account.connected ? `Connected${account.last_sync ? ' · synced ' + describeLastRefresh(account.last_sync) : ''}` : 'Not connected'}</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={!status?.configured || Boolean(busy)} onClick={() => void connect(account.email)}>{account.connected ? 'Reconnect' : 'Connect'}</Button>
          {account.connected && <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void run('Disconnecting', () => bridge().calendar.disconnect(account.email))}>Disconnect</Button>}
        </div>
      </div>
      {account.error && <p className="mt-2 text-sm text-accent-text">{account.error}</p>}
      {account.connected && <div className="mt-3 space-y-2">
        {account.calendars.map((calendar) => <label key={calendar.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={calendar.selected} disabled={Boolean(busy)} onChange={(e) => {
            const selected = account.calendars.filter((c) => c.id === calendar.id ? e.target.checked : c.selected).map((c) => c.id)
            void run('Updating calendars', () => bridge().calendar.selectCalendars(account.email, selected), true)
          }} />
          <span className="h-2 w-2 rounded-full" style={{ background: calendar.color }} />
          {calendar.name}{calendar.primary ? ' (primary)' : ''}
        </label>)}
        <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void run('Finding calendars', () => bridge().calendar.calendars(account.email))}>Refresh calendar list</Button>
      </div>}
    </div>)}
    <div className="flex items-end gap-3"><Input label="Add another Google account" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
      <Button variant="secondary" disabled={!status?.configured || Boolean(busy)} onClick={() => void connect(email.trim() || undefined)}>Connect account</Button></div>
    {busy && <div className="flex items-center gap-3 text-sm"><span>{busy === 'Connecting' ? 'Finish signing in with Google in your browser…' : `${busy}…`}</span>
      {busy === 'Connecting' && <Button variant="ghost" size="sm" onClick={() => void bridge().calendar.cancelConnect()}>Cancel sign-in</Button>}</div>}
    {error && <p role="alert" className="whitespace-pre-line text-sm text-accent-text">{error}</p>}
    <p className="text-xs text-muted">A school or work administrator may need to approve calendar access. Sign-in tokens are encrypted on this Mac and never stored in your notes or GitHub repository.</p>
  </Dialog>
}
