import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { contactKey } from './protocol'

export interface Snapshot { database: string; chatId: number; chatGuid: string; tail: number }
export interface Message {
  id: number; guid: string; chat_id: number; chat_guid: string; participants: string[]
  is_group: boolean; sender: string; is_from_me: boolean; text: string; created_at: string
}
export interface Page { messages: Message[]; next_rowid: number; has_more: boolean }
export interface Reader {
  snapshot(contact: string): Promise<Snapshot>
  after(chatId: number, cursor: number): Promise<Page>
}

function run(file: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('Cannot read Messages. In System Settings → Privacy & Security → Full Disk Access, enable Dès vu, then quit and reopen the app.'))
      else resolve(stdout)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

/** No sending, AppleScript, private framework injection, or arbitrary RPC surface. */
export function createMessagesReader(appRoot: string, db = path.join(homedir(), 'Library/Messages/chat.db')): Reader {
  return {
    async snapshot(contact) {
      const key = contactKey(contact) // character allowlist also prevents SQL interpolation
      const sql = `SELECT c.ROWID AS chatId, c.guid AS chatGuid, COALESCE((SELECT MAX(message_id) FROM chat_message_join WHERE chat_id=c.ROWID),0) AS tail FROM chat c WHERE c.chat_identifier='${key}' AND c.service_name='iMessage' AND (SELECT COUNT(*) FROM chat_handle_join WHERE chat_id=c.ROWID)=1 AND EXISTS (SELECT 1 FROM chat_handle_join j JOIN handle h ON h.ROWID=j.handle_id WHERE j.chat_id=c.ROWID AND lower(h.id)='${key}');`
      const rows = JSON.parse(await run('/usr/bin/sqlite3', ['-readonly', '-json', db, sql]) || '[]') as Omit<Snapshot, 'database'>[]
      if (rows.length !== 1) throw new Error('Could not identify one matching private iMessage chat. Check the contact and send it a message in Messages first.')
      const info = await stat(db)
      return { ...rows[0]!, database: `${info.dev}:${info.ino}:${info.birthtimeMs}` }
    },
    async after(chatId, cursor) {
      const request = { jsonrpc: '2.0', id: 'read', method: 'messages.after', params: {
        chat_id: chatId, since_rowid: cursor, limit: 100, attachments: false, include_reactions: false,
      } }
      const raw = await run(path.join(appRoot, 'resources/imsg/imsg'), ['rpc', '--db', db], JSON.stringify(request) + '\n')
      const result = raw.trim().split('\n').map((line) => JSON.parse(line)).find((reply) => reply.id === 'read')
      if (result?.error) throw new Error(result.error.code === -32002 ? 'Messages access is unavailable. Enable Full Disk Access for Dès vu, then quit and reopen it.' : 'The Messages reader could not complete the read. Try Check now again.')
      const page = result?.result as Page
      if (!page || !Array.isArray(page.messages) || !Number.isSafeInteger(page.next_rowid) || page.next_rowid < cursor || typeof page.has_more !== 'boolean') throw new Error('Invalid response from Messages reader.')
      return page
    },
  }
}
