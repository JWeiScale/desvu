export interface InstinctActivity {
  at: number
  kind: 'task' | 'goal' | 'note' | 'notice'
  title: string
}

export interface InstinctStatus {
  enabled: boolean
  contact: string
  connected: boolean
  lastChecked: number | null
  error: string | null
  activity: InstinctActivity[]
}

export const INSTINCT_INSTRUCTIONS = `Please remember this Dès vu connection protocol for this conversation. My Mac app reads only this chat and imports only replies to my messages beginning with "Desvu:". For each such request, reply with exactly one plain-text line starting DESVU followed by one JSON object. Do not use Markdown fences or add commentary to that reply. Include "request" with my exact full original message, and "kind" of "task", "goal", or "note". Create only one item per request; ask a clarifying question if it is ambiguous.\nTask: required "title"; optional "due" (YYYY-MM-DD), "category" (personal, school, recruiting, ml-systems, reinforcement-learning), "notes", "scheduled_start" and "scheduled_end" (both ISO timestamps with explicit timezone). Goal: required "title" and "deadline" (YYYY-MM-DD); optional "notes". Note: required "text". Do not include other fields. Resolve relative dates using the date of my request and America/New_York time; ask if a deadline or time is unclear. This connection only creates items: it cannot read my vault or calendar, change or delete existing items, or send messages. Never claim the item was saved on my Mac; only Dès vu can confirm an import. For ordinary messages without the prefix, continue normally. Please acknowledge these instructions without emitting a DESVU payload.`
