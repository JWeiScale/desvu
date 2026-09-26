import { readFile, mkdir, rename, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempVault, type TempVault } from './helpers/vault'
import { contactKey, explicitRequest, parseCommand } from '../src/main/instinct/protocol'
import { createInstinctConnector, importCommand } from '../src/main/instinct/connector'
import type { Message, Reader, Snapshot } from '../src/main/instinct/reader'
import { todoRepository } from '../src/main/repos/todoRepository'
import { goalRepository } from '../src/main/repos/goalRepository'
import { inboxRepository } from '../src/main/repos/inboxRepository'

let vault: TempVault
const contact = '+15555550199'
const request = 'Desvu: create a test goal by October 2, 2026.'
const payload = { request, kind: 'goal', title: 'Test goal', deadline: '2026-10-02' }
const snapshot: Snapshot = { database: 'fixture:1', chatId: 7, chatGuid: 'chat-guid', tail: 10 }
function message(id: number, text: string, fromMe = false, patch: Partial<Message> = {}): Message {
  return { id, guid: `guid-${id}`, chat_id: 7, chat_guid: 'chat-guid', participants: [contact],
    is_group: false, sender: fromMe ? '' : contact, is_from_me: fromMe, text,
    created_at: `2026-09-25T14:00:${String(id).padStart(2, '0')}Z`, ...patch }
}
function fixture() {
  let rows: Message[] = []
  let current = { ...snapshot }
  const reader: Reader = {
    snapshot: vi.fn(async () => ({ ...current })),
    after: vi.fn(async (_chat, cursor) => {
      const eligible = rows.filter((item) => item.id > cursor)
      const messages = eligible.slice(0, 2)
      return { messages, next_rowid: messages.at(-1)?.id ?? cursor, has_more: eligible.length > messages.length }
    }),
  }
  return { reader, rows: (value: Message[]) => { rows = value; current.tail = Math.max(10, ...value.map((item) => item.id)) },
    snapshot: (value: Snapshot) => { current = value } }
}
beforeEach(async () => { vault = await createTempVault('instinct') })
afterEach(async () => { await vault.dispose() })

describe('Instinct protocol', () => {
  it('accepts explicit requests and rejects SQL-like or invalid contacts', () => {
    expect(contactKey('+1 (555) 555-0199')).toBe(contact)
    expect(contactKey('Instinct@example.com')).toBe('instinct@example.com')
    expect(() => contactKey("a' OR 1=1--")).toThrow()
    expect(explicitRequest('Desvu: add a task')).toBe(true)
    expect(explicitRequest('please quote Desvu: add a task')).toBe(false)
    expect(explicitRequest('Desvu: ')).toBe(false)
  })
  it('requires whole-message JSON and allowed fields', () => {
    expect(parseCommand('prose DESVU ' + JSON.stringify(payload))).toBeNull()
    expect(() => parseCommand('DESVU {broken')).toThrow()
    for (const extra of [{ command: 'rm' }, { path: '../x' }, { kind: 'delete' }, { deadline: '2026-02-30' }]) {
      expect(() => parseCommand('DESVU ' + JSON.stringify({ ...payload, ...extra }))).toThrow()
    }
  })
  it('validates scheduled tasks, categories, required dates, and timezone offsets', () => {
    const task = { request, kind: 'task', title: 'Read', category: 'ml-systems', scheduled_start: '2026-10-02T10:00:00-04:00', scheduled_end: '2026-10-02T10:30:00-04:00' }
    expect(parseCommand('DESVU ' + JSON.stringify(task))?.kind).toBe('task')
    for (const extra of [{ scheduled_end: undefined }, { scheduled_start: '2026-10-02T10:00:00' }, { scheduled_end: '2026-10-02T09:00:00-04:00' }, { category: 'finance' }, { due: '2026-10-03' }]) {
      expect(() => parseCommand('DESVU ' + JSON.stringify({ ...task, ...extra }))).toThrow()
    }
    expect(() => parseCommand('DESVU ' + JSON.stringify({ ...payload, deadline: undefined }))).toThrow()
  })
})

describe('Instinct importing', () => {
  it('atomically deduplicates tasks, goals, and notes even under concurrent replay', async () => {
    const commands = [payload, { request, kind: 'task', title: 'Test task' }, { request, kind: 'note', text: 'Test note\n- [ ] extra line' }]
    for (const [index, value] of commands.entries()) {
      const command = parseCommand('DESVU ' + JSON.stringify(value))!
      await Promise.all(Array.from({ length: 3 }, () => importCommand(command, `request-${index}`, Date.parse('2026-09-25T14:00:00Z'))))
    }
    expect(await todoRepository.list()).toHaveLength(1)
    expect(await goalRepository.list()).toHaveLength(1)
    const notes = await inboxRepository.read()
    expect(notes).toHaveLength(1)
    expect(notes[0]!.line).not.toContain('desvu-import:')
  })
  it('starts from the tail, follows pages, persists pending requests, and resumes without duplicates', async () => {
    const f = fixture()
    f.rows([message(9, request, true), message(10, 'DESVU ' + JSON.stringify(payload))])
    const options = { statePath: vault.at('connection.json'), reader: f.reader }
    const first = createInstinctConnector(options)
    expect((await first.configure(contact, true)).connected).toBe(true)
    expect(await goalRepository.list()).toHaveLength(0)
    f.rows([message(11, request, true)])
    await first.check()
    const resumed = createInstinctConnector(options)
    f.rows([message(11, request, true), message(12, 'ordinary reply'), message(13, 'DESVU ' + JSON.stringify(payload)), message(14, 'DESVU ' + JSON.stringify(payload))])
    const status = await resumed.check()
    expect(status.error).toBeNull()
    expect(status.activity.filter((entry) => entry.kind === 'goal')).toHaveLength(1)
    expect(await goalRepository.list()).toHaveLength(1)
    await createInstinctConnector(options).check()
    expect(await goalRepository.list()).toHaveLength(1)
  })
  it('ignores unsolicited output, groups, wrong chat, wrong sender, and expired requests', async () => {
    const f = fixture()
    const connector = createInstinctConnector({ statePath: vault.at('connection.json'), reader: f.reader })
    await connector.configure(contact, true)
    const response = 'DESVU ' + JSON.stringify(payload)
    f.rows([message(11, response), message(12, request, true, { is_group: true }), message(13, response),
      message(14, request, true), message(15, response, false, { chat_id: 8 }),
      message(16, response, false, { sender: '+15555550123' }),
      message(17, response, false, { participants: [contact, '+15555550123'] }),
      message(18, response, false, { created_at: '2026-09-27T14:00:00Z' })])
    await connector.check()
    expect(await goalRepository.list()).toHaveLength(0)
  })
  it('pauses, catches up on resume, and fails closed after database replacement', async () => {
    const f = fixture()
    const connector = createInstinctConnector({ statePath: vault.at('connection.json'), reader: f.reader })
    await connector.configure(contact, true)
    await connector.configure(contact, false)
    f.rows([message(11, request, true), message(12, 'DESVU ' + JSON.stringify(payload))])
    await connector.check()
    expect(await goalRepository.list()).toHaveLength(0)
    await connector.configure(contact, true)
    expect(await goalRepository.list()).toHaveLength(1)
    f.snapshot({ ...snapshot, database: 'replacement' })
    const failed = await connector.check()
    expect(failed.enabled).toBe(false)
    expect(failed.error).toMatch(/database changed/)
    expect((await connector.configure(contact, true)).connected).toBe(true)
  })
  it('recovers when an import succeeds but the cursor cannot be saved', async () => {
    const f = fixture()
    const statePath = vault.at('connector/connection.json')
    let fail = true
    const connector = createInstinctConnector({ statePath, reader: f.reader, import: async (...args) => {
      await importCommand(...args)
      if (fail) {
        fail = false
        await rename(statePath, statePath + '.backup')
        await mkdir(statePath)
      }
    } })
    await connector.configure(contact, true)
    f.rows([message(11, request, true), message(12, 'DESVU ' + JSON.stringify(payload))])
    expect((await connector.check()).error).not.toBeNull()
    expect(await goalRepository.list()).toHaveLength(1)
    await rm(statePath, { recursive: true })
    await rename(statePath + '.backup', statePath)
    expect((await createInstinctConnector({ statePath, reader: f.reader }).check()).error).toBeNull()
    expect(await goalRepository.list()).toHaveLength(1)
    expect(JSON.parse(await readFile(statePath, 'utf8')).cursor).toBe(12)
  })
  it('surfaces permission errors and retries instead of advancing the cursor', async () => {
    const f = fixture()
    const connector = createInstinctConnector({ statePath: vault.at('connection.json'), reader: f.reader })
    vi.mocked(f.reader.snapshot).mockRejectedValueOnce(new Error('Full Disk Access required'))
    expect((await connector.configure(contact, true)).error).toMatch(/Full Disk Access/)
    expect((await connector.check()).connected).toBe(true)
  })
  it('uses the authoritative cursor even for suppressed empty pages', async () => {
    const f = fixture()
    const connector = createInstinctConnector({ statePath: vault.at('connection.json'), reader: f.reader })
    await connector.configure(contact, true)
    f.snapshot({ ...snapshot, tail: 15 })
    vi.mocked(f.reader.after).mockResolvedValueOnce({ messages: [], next_rowid: 14, has_more: true })
    await connector.check()
    expect(f.reader.after).toHaveBeenLastCalledWith(7, 14)
    expect(JSON.parse(await readFile(vault.at('connection.json'), 'utf8')).cursor).toBe(14)
  })
})
