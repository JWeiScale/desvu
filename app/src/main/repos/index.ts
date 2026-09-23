/**
 * Every file-backed repository, in one place. The main process wires these into the IPC
 * router; nothing else in the app is allowed to touch `fs` inside the vault.
 */
export { goalRepository } from './goalRepository'
export { brainDumpRepository } from './brainDumpRepository'
export { synthesisRepository } from './synthesisRepository'
export { calendarRepository } from './calendarRepository'
export { financeRepository, UNCATEGORISED } from './financeRepository'
export { inboxRepository, formatInboxLine, inboxFileFor, INBOX_SEPARATOR } from './inboxRepository'
export { journalRepository } from './journalRepository'
export { libraryRepository } from './libraryRepository'
export { mealRepository } from './mealRepository'
export { searchRepository } from './searchRepository'
export { settingsRepository } from './settingsRepository'
export { systemRepository, obsidianUrl, setExternalOpener } from './systemRepository'
export { todoRepository, CORRECTION_CONFIDENCE_THRESHOLD } from './todoRepository'
export { workoutRepository } from './workoutRepository'

export type { InboxLine, InboxSource } from './inboxRepository'
export type { CreateLibraryInput } from './libraryRepository'
