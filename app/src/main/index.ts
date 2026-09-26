import { createInstinctConnector } from './instinct/connector'
import { createMessagesReader } from './instinct/reader'
import { setInstinctConnector } from './ipc-router'
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  shell,
} from 'electron'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { IPC_EVENTS } from '@shared/ipc'
import { resolveVaultPath } from '@shared/vault'
import { registerIpcHandlers } from './ipc-router'

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const IS_MAC = process.platform === 'darwin'
const IS_DEV = !app.isPackaged

/** Matches the `--bg` token in `renderer/src/styles/tokens.css`. Set on the native window
 *  so the first paint is warm paper / warm black, never a white flash. */
const WINDOW_BG = { light: '#FDFAF3', dark: '#0B0A08' } as const

/** PRD C8 — desktop quick capture. Reaches the app even when it is not focused. */
const QUICK_CAPTURE_ACCELERATOR = 'CommandOrControl+Shift+Space'

/** Now declared on `@shared/ipc` alongside the other push events. */
const EVENT_QUICK_CAPTURE = IPC_EVENTS.quickCapture

/**
 * Production renderers are served from `desvu://app/` rather than `file://`.
 *
 * Two reasons, both load-bearing. `file://` pages have a null origin, so a
 * `default-src 'self'` CSP blocks the app's own bundle — meaning `file://` effectively
 * cannot have a strict CSP, and this app ingests arbitrary fetched URLs into the corpus.
 * And root-absolute asset paths (`/fonts/*.woff2`, written by the generated `fonts.css`)
 * resolve against the filesystem root under `file://` and break.
 */
const APP_SCHEME = 'desvu'
const APP_ORIGIN = `${APP_SCHEME}://app`

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

const HERE = fileURLToPath(new URL('.', import.meta.url))

/**
 * electron-vite emits `.mjs` when `package.json` says `"type": "module"` and `.js`/`.cjs`
 * otherwise. Probing keeps the shell working either way — and the extension decides
 * whether the renderer can be sandboxed, since Electron only loads an ESM preload in an
 * unsandboxed renderer. `contextIsolation` stays on in both cases; that is the boundary
 * that actually matters.
 */
function resolvePreload(): string {
  const dir = path.join(HERE, '..', 'preload')
  for (const name of ['index.mjs', 'index.js', 'index.cjs']) {
    const candidate = path.join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return path.join(dir, 'index.mjs')
}

const RENDERER_ROOT = path.join(HERE, '..', 'renderer')

/** Must run before `app.whenReady()`. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const requested = decodeURIComponent(new URL(request.url).pathname)
    const resolved = path.normalize(path.join(RENDERER_ROOT, requested))

    // Traversal guard: anything that escapes the bundle falls back to the entry document.
    const inBundle = resolved === RENDERER_ROOT || resolved.startsWith(RENDERER_ROOT + path.sep)
    const isFile = inBundle && existsSync(resolved) && statSync(resolved).isFile()
    const target = isFile ? resolved : path.join(RENDERER_ROOT, 'index.html')

    return net.fetch(pathToFileURL(target).toString())
  })
}

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const preload = resolvePreload()

  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light,
    // A quiet frame: no chrome bar, traffic lights floated over the sidebar's top rail.
    // The renderer reserves 44px of drag region there (`components/shell/Sidebar.tsx`).
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 20 },
    title: 'Dès vu',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !preload.endsWith('.mjs'),
      spellcheck: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Nothing in this app should ever navigate the shell or spawn a child window.
  // Links go to the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer && url.startsWith(devServer)) return
    if (url.startsWith(`${APP_SCHEME}://`)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (IS_DEV && devServer) {
    void win.loadURL(devServer)
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`)
  }

  return win
}

function focusMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return mainWindow
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// ---------------------------------------------------------------------------
// vault watcher
// ---------------------------------------------------------------------------

/**
 * Three writers touch the vault behind the app's back: Obsidian, the Telegram bot, and
 * the calendar/Gmail refresh scripts. Without this the UI would show a stale corpus until
 * the next manual action. Debounced so a `git checkout` or an iCloud sync burst produces
 * one revalidation rather than several hundred.
 */
const WATCH_DEBOUNCE_MS = 250
const MAX_REPORTED_PATHS = 64

/** Directory or filename segments that are never interesting to the UI. */
const IGNORED_SEGMENTS = new Set([
  '.git',
  '.obsidian',
  '.trash',
  '.impeccable',
  '.claude',
  'node_modules',
])

function isIgnored(relativePath: string): boolean {
  if (!relativePath) return true
  const segments = relativePath.split(path.sep)
  for (const segment of segments) {
    if (IGNORED_SEGMENTS.has(segment)) return true
  }
  const base = segments[segments.length - 1] ?? ''
  if (base === '.DS_Store') return true
  // Atomic writes (temp-file-and-rename) and iCloud both stage through dotfiles.
  if (base.startsWith('.')) return true
  if (base.endsWith('~') || base.endsWith('.tmp') || base.endsWith('.swp')) return true
  return false
}

let watcher: FSWatcher | null = null
let pending = new Set<string>()
let debounceTimer: NodeJS.Timeout | null = null

function flushVaultChanges(): void {
  debounceTimer = null
  if (pending.size === 0) return
  const paths = [...pending].slice(0, MAX_REPORTED_PATHS)
  const truncated = pending.size > paths.length
  pending = new Set()
  broadcast(IPC_EVENTS.vaultChanged, { at: Date.now(), paths, truncated })
}

function startVaultWatcher(): void {
  let root: string
  try {
    root = resolveVaultPath()
  } catch (error) {
    // A missing vault must not stop the app from opening — the UI degrades to empty
    // states and the storage layer reports the same failure through IPC.
    console.warn('[desvu] vault watcher disabled:', (error as Error).message)
    return
  }

  try {
    watcher = watch(root, { recursive: true, persistent: false }, (_eventType, filename) => {
      if (!filename) return
      const relative = filename.toString()
      if (isIgnored(relative)) return
      pending.add(relative)
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flushVaultChanges, WATCH_DEBOUNCE_MS)
    })
    watcher.on('error', (error) => {
      console.warn('[desvu] vault watcher error:', error)
    })
    console.log('[desvu] watching vault at', root)
  } catch (error) {
    console.warn('[desvu] could not watch vault:', (error as Error).message)
  }
}

function stopVaultWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  watcher?.close()
  watcher = null
  pending = new Set()
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

// One instance only; a second launch focuses the window we already have.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  void app.whenReady().then(() => {
    app.setName('Dès vu')

    // The default User-Agent embeds the product name, and "Dès vu" is not ASCII. HTTP
    // header values are ByteStrings (one byte per character), so the accent makes
    // `protocol.handle` throw while building the request's Headers — every asset served
    // over `desvu://` would be at risk. Strip the UA down to printable ASCII.
    app.userAgentFallback = app.userAgentFallback.replace(/[^\x20-\x7e]/g, '')

    registerAppProtocol()

    // Owned by the storage workstream (`src/main/ipc-router.ts`). Registers a handler
    // for every entry in IPC_CHANNELS; a stub until the repositories land, which means
    // renderer calls reject and the UI falls through to its error/empty states.
    registerIpcHandlers(ipcMain, broadcast, app.getAppPath())

    const instinct = createInstinctConnector({
      statePath: path.join(app.getPath('userData'), 'instinct/connection.json'),
      reader: createMessagesReader(app.getAppPath()),
    })
    setInstinctConnector(instinct)
    instinct.start()
    app.on('will-quit', () => instinct.stop())

    startVaultWatcher()
    mainWindow = createWindow()

    nativeTheme.on('updated', () => {
      const bg = nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setBackgroundColor(bg)
      }
    })

    const registered = globalShortcut.register(QUICK_CAPTURE_ACCELERATOR, () => {
      const win = focusMainWindow()
      win?.webContents.send(EVENT_QUICK_CAPTURE, { at: Date.now() })
    })
    if (!registered) {
      console.warn(`[desvu] could not register ${QUICK_CAPTURE_ACCELERATOR}; it is already taken`)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
      else focusMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // macOS convention: the app lives on in the dock with no window.
    if (!IS_MAC) app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    stopVaultWatcher()
  })
}
