import { createHash } from 'node:crypto'
import { CATEGORIES } from '@shared/types'
import type { Category, CreateGoalInput, CreateTodoInput } from '@shared/types'
import { validateSchedule } from '@shared/scheduling'
import { Issues, checkDate } from '../lib/validate'

export type Command = { request: string } & (
  { kind: 'task'; input: CreateTodoInput } |
  { kind: 'goal'; input: CreateGoalInput } |
  { kind: 'note'; text: string }
)

export function contactKey(value: string): string {
  if (typeof value !== 'string') throw new Error('Enter an Instinct phone number or email.')
  const normalized = value.trim().toLowerCase().replace(/[()\s-]/g, '')
  if (!/^\+[1-9]\d{6,14}$/.test(normalized) && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) {
    throw new Error('Use an international phone number (including +) or an email address.')
  }
  return normalized
}

export function importId(requestGuid: string): string {
  return `instinct_${createHash('sha256').update(requestGuid).digest('hex')}`
}

export function explicitRequest(text: string): boolean {
  return typeof text === 'string' && /^Desvu:\s*\S/i.test(text) && text.length <= 4000
}

function text(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be nonempty text (up to ${max} characters).`)
  return value.trim()
}
function date(value: unknown, label: string): string {
  const issues = new Issues()
  checkDate(issues, label, value)
  issues.throwIfAny()
  return value as string
}

/** A whole-message protocol, never a JSON search inside prose or quoted instructions. */
export function parseCommand(raw: string): Command | null {
  if (!raw.startsWith('DESVU ')) return null
  if (raw.length > 14000) throw new Error('Instinct reply is too long.')
  let value: Record<string, unknown>
  try { value = JSON.parse(raw.slice(6)) } catch { throw new Error('Instinct sent invalid JSON. Ask it to resend using the connection protocol.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected one command object.')
  const request = text(value.request, 'Request')
  if (!explicitRequest(request)) throw new Error('Reply must quote a Desvu: request.')
  const common = ['kind', 'request']
  const fields = value.kind === 'task' ? ['title', 'due', 'category', 'notes', 'scheduled_start', 'scheduled_end']
    : value.kind === 'goal' ? ['title', 'deadline', 'notes'] : value.kind === 'note' ? ['text'] : []
  if (!fields.length || Object.keys(value).some((key) => ![...common, ...fields].includes(key))) throw new Error('Unsupported command or field. Only create task, goal, and note are supported.')
  if (value.kind === 'note') return { kind: 'note', request, text: text(value.text, 'Note') }
  const title = text(value.title, 'Title', 500)
  const notes = value.notes === undefined ? '' : text(value.notes, 'Notes')
  if (value.kind === 'goal') return { kind: 'goal', request, input: { title, deadline: date(value.deadline, 'Deadline'), notes } }
  if (value.category !== undefined && !(CATEGORIES as readonly unknown[]).includes(value.category)) throw new Error('Unknown task category.')
  const input: CreateTodoInput = { text: title, notes, source: 'import', category: value.category as Category | undefined }
  if (value.due !== undefined) input.due = date(value.due, 'Due date')
  if (value.scheduled_start !== undefined || value.scheduled_end !== undefined) {
    input.scheduled_start = text(value.scheduled_start, 'Start')
    input.scheduled_end = text(value.scheduled_end, 'End')
    date(input.scheduled_start.slice(0, 10), 'Start date')
    date(input.scheduled_end.slice(0, 10), 'End date')
    validateSchedule(input)
    if (input.due && input.due !== input.scheduled_start.slice(0, 10)) throw new Error('Task due date conflicts with its scheduled day.')
  }
  return { kind: 'task', request, input }
}
