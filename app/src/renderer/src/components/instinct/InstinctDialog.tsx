import { useCallback, useEffect, useRef, useState } from 'react'
import { INSTINCT_INSTRUCTIONS, type InstinctStatus } from '@shared/instinct'
import { bridge, readableMessage } from '@/lib/bridge'
import { Button } from '../Button'
import { Dialog } from '../Dialog'
import { Input, Textarea } from '../Input'

export function InstinctDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<InstinctStatus | null>(null)
  const [contact, setContact] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [instructions, setInstructions] = useState(false)
  const working = useRef(false)
  const close = useCallback(() => { if (!working.current) onClose() }, [onClose])
  useEffect(() => {
    let alive = true
    let first = true
    const refresh = (): void => {
      void bridge().instinct.status().then((value) => {
        if (!alive) return
        setStatus(value)
        if (first) { setContact(value.contact); first = false }
      }).catch((failure) => { if (alive) setError(readableMessage(failure)) })
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  const run = async (action: () => Promise<InstinctStatus>): Promise<void> => {
    if (working.current) return
    working.current = true; setBusy(true); setError(null)
    try { setStatus(await action()) } catch (failure) { setError(readableMessage(failure)) }
    finally { working.current = false; setBusy(false) }
  }
  return <Dialog open onClose={close} title="Instinct in iMessage" size="md"
    description="Turn requests in your Instinct chat into tasks, goals, and Inbox notes."
    className="max-h-[76vh] overflow-y-auto"
    footer={<Button size="sm" disabled={busy} onClick={close}>Done</Button>}>
    <Input label="Instinct phone number or email" placeholder="+1…" value={contact}
      disabled={busy || status?.enabled} onChange={(event) => setContact(event.target.value)} />
    <p className="text-muted text-sm">Runs while Dès vu is open and catches up after you reopen it.
      The first connection starts with new messages. Start requests with <strong>Desvu:</strong> and send Instinct the instructions below once.</p>
    <p className="text-muted text-sm">Requires macOS Full Disk Access for Dès vu. That permission covers more than Messages;
      this connector reads only the selected private chat and never sends messages or attachments.</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="primary" disabled={busy || !contact.trim() || !status}
        onClick={() => void run(() => bridge().instinct.configure(contact, !status?.enabled))}>
        {status?.enabled ? 'Pause connection' : 'Connect Instinct'}
      </Button>
      <Button size="sm" disabled={busy || !status?.enabled} onClick={() => void run(() => bridge().instinct.check())}>Check now</Button>
      <Button size="sm" onClick={() => setInstructions(!instructions)}>{instructions ? 'Hide instructions' : 'Setup instructions'}</Button>
    </div>
    <p role="status" className="text-sm">{busy ? 'Checking…' : status?.connected ? 'Connected · checking every 5 seconds' : status?.enabled ? 'Waiting for connection' : 'Paused'}
      {status?.lastChecked ? ` · Last checked ${new Date(status.lastChecked).toLocaleTimeString()}` : ''}</p>
    {(error || status?.error) && <p role="alert" className="text-ink2 text-sm">{error ?? status?.error}</p>}
    {instructions && <Textarea label="Send this to your Instinct chat" readOnly rows={7} value={INSTINCT_INSTRUCTIONS}
      onFocus={(event) => event.currentTarget.select()} />}
    <div className="rounded-panel bg-card border-line border p-4 text-sm">
      <p>Try: <strong>Desvu: add a goal to finish my ML Systems notes by October 2, 2026.</strong></p>
      <p className="text-muted mt-2">One item per request. Check the activity below to confirm it saved.</p>
    </div>
    <div className="flex flex-col gap-2 text-sm">
      <h3 className="font-medium">Recent activity</h3>
      {!status?.activity.length && <p className="text-muted">No imports yet.</p>}
      {status?.activity.slice(0, 10).map((item, index) => <p key={`${item.at}-${index}`} className="break-words">
        <span className="text-muted">{new Date(item.at).toLocaleTimeString()} · {item.kind === 'notice' ? 'Notice' : `Saved ${item.kind}`} · </span>{item.title}
      </p>)}
    </div>
  </Dialog>
}
