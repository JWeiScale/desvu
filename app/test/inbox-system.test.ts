import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calendarRepository } from '../src/main/repos/calendarRepository'
import {
  formatInboxLine,
  inboxDayHeading,
  inboxRepository,
} from '../src/main/repos/inboxRepository'
import { obsidianUrl, setExternalOpener, systemRepository } from '../src/main/repos/systemRepository'
import { createTempVault, dayOffset, type TempVault } from './helpers/vault'

let vault: TempVault

beforeEach(async () => {
  vault = await createTempVault('inbox')
})

afterEach(async () => {
  await vault.dispose()
})

const today = () => dayOffset(0)

describe('inbox line format — shared byte-for-byte with the Telegram bot', () => {
  it('formats a capture exactly as documented', () => {
    const at = new Date(2026, 7, 1, 14, 32)
    expect(formatInboxLine('the raw text exactly as sent', 'telegram', at)).toBe(
      '- [ ] 14:32 · telegram · the raw text exactly as sent'
    )
    expect(formatInboxLine('a photo', 'telegram', at, 'IMG_0421.jpg')).toBe(
      '- [ ] 14:32 · telegram · a photo → [[Attachments/IMG_0421.jpg]]'
    )
  })

  it('pads single-digit hours and minutes', () => {
    expect(formatInboxLine('early', 'app', new Date(2026, 7, 1, 9, 5))).toBe(
      '- [ ] 09:05 · app · early'
    )
  })

  it('appends to today`s file and never rewrites what is already there', async () => {
    await inboxRepository.append('first capture', 'telegram', new Date(`${today()}T08:00:00`))
    await inboxRepository.append('second capture', 'app', new Date(`${today()}T09:30:00`))

    const raw = await readFile(vault.at('Inbox', `${today()}.md`), 'utf8')
    expect(raw.split('\n').filter(Boolean)).toEqual([
      `# ${today()}`,
      '- [ ] 08:00 · telegram · first capture',
      '- [ ] 09:30 · app · second capture',
    ])
  })

  it('opens a new day file with the same heading the bot writes', async () => {
    // Whichever writer captures first that day decides the file's shape, so the two
    // must agree. A heading that appeared only on days the bot happened to see first
    // would be a confusing artifact in Obsidian.
    await inboxRepository.append('first of the day', 'app', new Date(`${today()}T07:15:00`))
    const raw = await readFile(vault.at('Inbox', `${today()}.md`), 'utf8')

    expect(raw).toBe(`# ${today()}\n\n- [ ] 07:15 · app · first of the day\n`)
    expect(raw.startsWith(inboxDayHeading(today()))).toBe(true)
  })

  it('does not add a second heading to a file the bot already created', async () => {
    await mkdir(vault.at('Inbox'), { recursive: true })
    await writeFile(
      vault.at('Inbox', `${today()}.md`),
      `# ${today()}\n\n- [ ] 06:00 · telegram · sent from the phone\n`,
      'utf8'
    )
    await inboxRepository.append('added by the app', 'app', new Date(`${today()}T10:00:00`))

    const raw = await readFile(vault.at('Inbox', `${today()}.md`), 'utf8')
    expect(raw.match(/^# /gm)).toHaveLength(1)
    expect(raw.split('\n').filter(Boolean)).toEqual([
      `# ${today()}`,
      '- [ ] 06:00 · telegram · sent from the phone',
      '- [ ] 10:00 · app · added by the app',
    ])
  })

  it('quick capture writes an app-sourced line', async () => {
    await systemRepository.quickCapture('todo email the Ramp recruiter p1 15m recruiting')
    const raw = await readFile(vault.at('Inbox', `${today()}.md`), 'utf8')
    expect(raw).toMatch(
      /^# \d{4}-\d{2}-\d{2}\n\n- \[ \] \d{2}:\d{2} · app · todo email the Ramp recruiter p1 15m recruiting\n$/
    )
  })

  it('rejects an empty capture', async () => {
    await expect(systemRepository.quickCapture('   ')).rejects.toThrow(/text cannot be empty/)
  })

  it('survives concurrent captures without dropping a line', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => inboxRepository.append(`capture ${index}`, 'app'))
    )
    await expect(inboxRepository.count()).resolves.toBe(20)
  })
})

describe('reading the inbox', () => {
  it('returns unsorted lines newest first, with a timestamp per line', async () => {
    await vault.write(
      `Inbox/${dayOffset(-1)}.md`,
      ['- [ ] 09:00 · telegram · yesterday morning', ''].join('\n')
    )
    await vault.write(
      `Inbox/${today()}.md`,
      [
        '# a heading a human added',
        '- [x] 07:00 · telegram · already routed by /sort-inbox',
        '- [ ] 14:32 · telegram · unrouted thought',
        '',
      ].join('\n')
    )

    const lines = await inboxRepository.read()
    expect(lines.map((line) => line.line)).toEqual([
      '- [ ] 14:32 · telegram · unrouted thought',
      '- [ ] 09:00 · telegram · yesterday morning',
    ])
    expect(lines[0]?.file).toBe(`Inbox/${today()}.md`)
    expect(new Date(lines[0]?.at ?? 0).getHours()).toBe(14)
    await expect(inboxRepository.count()).resolves.toBe(2)
  })

  it('keeps a line that does not match the bot format rather than dropping it', async () => {
    await vault.write(`Inbox/${today()}.md`, 'a bare line someone pasted in\n')
    const lines = await inboxRepository.read()
    expect(lines).toHaveLength(1)
    expect(lines[0]?.line).toBe('a bare line someone pasted in')
  })

  it('reads as empty when nothing has ever been captured', async () => {
    await expect(inboxRepository.read()).resolves.toEqual([])
    await expect(inboxRepository.count()).resolves.toBe(0)
  })
})

describe('calendar (read-only, refresh script not built yet)', () => {
  it('returns no events and no refresh time when the file is missing', async () => {
    await expect(calendarRepository.forDate(today())).resolves.toEqual([])
    await expect(calendarRepository.lastRefresh()).resolves.toBeNull()
  })

  it('reads the object shape with a refresh stamp', async () => {
    await vault.writeJson('data/calendar.json', {
      last_refresh: 1754006400000,
      events: [
        {
          id: 'a',
          title: 'lecture',
          start: `${today()}T10:00:00-07:00`,
          end: `${today()}T11:00:00-07:00`,
          all_day: false,
          location: 'GHC 4401',
        },
      ],
    })

    const events = await calendarRepository.forDate(today())
    expect(events).toHaveLength(1)
    expect(events[0]?.location).toBe('GHC 4401')
    await expect(calendarRepository.lastRefresh()).resolves.toBe(1754006400000)
  })

  it('also reads a bare array, falling back to the file mtime', async () => {
    await vault.writeJson('data/calendar.json', [
      {
        id: 'a',
        title: 'standup',
        start: `${today()}T09:00:00-07:00`,
        end: `${today()}T09:15:00-07:00`,
        all_day: false,
      },
    ])

    await expect(calendarRepository.forDate(today())).resolves.toHaveLength(1)
    await expect(calendarRepository.lastRefresh()).resolves.toBeGreaterThan(0)
  })

  it('ignores entries that are not events instead of failing the whole day', async () => {
    await vault.writeJson('data/calendar.json', { events: [{ nonsense: true }, null, 42] })
    await expect(calendarRepository.forDate(today())).resolves.toEqual([])
  })
})

describe('system', () => {
  it('reports the vault path', async () => {
    await expect(systemRepository.vaultPath()).resolves.toBe(vault.root)
  })

  it('builds an obsidian:// URL with both parameters encoded', () => {
    expect(obsidianUrl('Dès vu', 'Brain Dump/Recruiting/systems-design.md')).toBe(
      'obsidian://open?vault=D%C3%A8s%20vu&file=Brain%20Dump%2FRecruiting%2Fsystems-design'
    )
    expect(obsidianUrl('Dès vu', 'Attachments/IMG_0421.jpg')).toBe(
      'obsidian://open?vault=D%C3%A8s%20vu&file=Attachments%2FIMG_0421.jpg'
    )
  })

  it('opens a vault-relative path through the shell', async () => {
    const opened: string[] = []
    setExternalOpener(async (url) => {
      opened.push(url)
    })

    await systemRepository.openInObsidian('Library/2026-08-01-ddia-ch5.md')
    expect(opened).toHaveLength(1)
    expect(opened[0]).toContain('obsidian://open?vault=')
    expect(opened[0]).toContain('Library%2F2026-08-01-ddia-ch5')
  })

  it('refuses an absolute path or one that escapes the vault', async () => {
    setExternalOpener(async () => undefined)
    await expect(systemRepository.openInObsidian('/etc/hosts')).rejects.toThrow(
      /must be vault-relative/
    )
    await expect(systemRepository.openInObsidian('../../.ssh/id_rsa')).rejects.toThrow(
      /escapes the vault/
    )
    await expect(systemRepository.openInObsidian('')).rejects.toThrow(/path is required/)
  })
})
