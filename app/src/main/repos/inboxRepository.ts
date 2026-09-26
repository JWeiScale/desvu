import path from 'node:path'
import type { DateString } from '@shared/types'
import { VAULT_SUBDIRS, vaultPath } from '@shared/vault'
import { atomicWriteFile, readTextFileOrNull } from '../lib/atomic'
import { parseDateString, timeHHMM, todayString } from '../lib/dates'
import { withFileLock } from '../lib/lock'
import { withVaultLock } from '../lib/vault-lock'
import { listDirectory } from '../lib/paths'
import { Issues, checkNonEmptyText } from '../lib/validate'

/**
 * The Inbox is the one format shared with the Telegram bot, so it is spelled out here
 * once and used by both capture surfaces (PRD C1/C8):
 *
 *     - [ ] 14:32 · telegram · the raw text exactly as sent
 *
 * `HH:MM` is local. The separator is U+00B7 with a space either side. Attachments end
 * the line with ` → [[Attachments/<filename>]]`. Nothing is parsed at capture time —
 * `/sort-inbox` does all the routing, so a malformed message is impossible.
 */
export const INBOX_SEPARATOR = ' · '
export type InboxSource = 'telegram' | 'app' | 'instinct'

export interface InboxLine {
  /** Vault-relative, so `system:openInObsidian` can be handed it directly. */
  file: string
  /** The line exactly as it sits on disk. */
  line: string
  at: number
}

export function formatInboxLine(
  text: string,
  source: InboxSource,
  now: Date = new Date(),
  attachment?: string
): string {
  const body = attachment ? `${text.trim()} → [[Attachments/${attachment}]]` : text.trim()
  return `- [ ] ${timeHHMM(now)}${INBOX_SEPARATOR}${source}${INBOX_SEPARATOR}${body}`
}

export function inboxFileFor(date: DateString): string {
  return `${VAULT_SUBDIRS.inbox}/${date}.md`
}

/**
 * A new day file opens with its date as a heading, matching `bot/src/inbox.js`.
 * Both writers must agree: whichever one happens to capture first that day decides
 * the file's shape, and a heading that appears only on days the bot saw first would
 * be a confusing artifact in Obsidian.
 */
export function inboxDayHeading(date: DateString): string {
  return `# ${date}\n\n`
}

/** A line already ticked off has been routed by the sort skill and is no longer unsorted. */
const SORTED = /^\s*-\s*\[[xX]\]/
const TIME_IN_LINE = /^\s*-\s*\[[ xX]?\]\s*(\d{2}):(\d{2})/

function timestampFor(fileDate: DateString, line: string): number {
  const base = parseDateString(fileDate)
  const match = TIME_IN_LINE.exec(line)
  if (match) {
    base.setHours(Number(match[1]), Number(match[2]), 0, 0)
  }
  return base.getTime()
}

export const inboxRepository = {
  /**
   * Raw unsorted lines, newest first. Lines the sort skill has ticked off are excluded;
   * lines that do not match the bot's format are still returned, because an unroutable
   * capture staying visible is the whole point of the Inbox.
   */
  async read(): Promise<InboxLine[]> {
    const directory = vaultPath(VAULT_SUBDIRS.inbox)
    const files = (await listDirectory(directory))
      .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
      .sort()

    const lines: InboxLine[] = []

    for (const name of files) {
      const raw = await readTextFileOrNull(path.join(directory, name))
      if (raw === null) continue

      const fileDate = name.replace(/\.md$/, '')
      const relative = `${VAULT_SUBDIRS.inbox}/${name}`

      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.replace(/ <!-- desvu-import:instinct_[a-f0-9]{64} -->$/, '').replace(/\s+$/, '')
        if (trimmed.trim() === '' || SORTED.test(trimmed)) continue
        // Skip markdown headings a human may have added to the day file.
        if (trimmed.trimStart().startsWith('#')) continue
        lines.push({ file: relative, line: trimmed, at: timestampFor(fileDate, trimmed) })
      }
    }

    return lines.sort((a, b) => b.at - a.at)
  },

  async count(): Promise<number> {
    return (await inboxRepository.read()).length
  },

  /**
   * Append one capture. Same file, same format, same lock as the bot's writes — two
   * capture surfaces, one Inbox (PRD C8).
   */
  async append(
    text: string,
    source: InboxSource = 'app',
    now: Date = new Date(),
    importId?: string
  ): Promise<InboxLine> {
    const issues = new Issues()
    checkNonEmptyText(issues, 'text', text)
    issues.throwIfAny()

    const date = todayString(now)
    const relative = inboxFileFor(date)
    const absolute = vaultPath(VAULT_SUBDIRS.inbox, `${date}.md`)
    const line = formatInboxLine(importId ? text.replace(/\s+/g, ' ') : text, source, now)
    const marker = importId ? ` <!-- desvu-import:${importId} -->` : ''

    // The Inbox has three writers — this app, the Telegram bot, and `/sort-inbox` ticking
    // lines off — all rewriting the same day file, so it takes the cross-process lock too.
    return withFileLock(absolute, async () =>
      withVaultLock(async () => {
        const existing = await readTextFileOrNull(absolute)
        if (marker && existing?.includes(marker)) return { file: relative, line, at: now.getTime() }
        const body =
          existing === null || existing === ''
            ? inboxDayHeading(date)
            : existing.replace(/\n+$/, '') + '\n'
        await atomicWriteFile(absolute, `${body}${line}${marker}\n`)
        return { file: relative, line, at: now.getTime() }
      })
    )
  },
}

export type InboxRepository = typeof inboxRepository
