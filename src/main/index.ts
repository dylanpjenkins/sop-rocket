import { app, shell, BrowserWindow, ipcMain, dialog, clipboard, screen, desktopCapturer, nativeImage } from 'electron'
import { join, dirname } from 'path'
import { pathToFileURL } from 'url'
import { readFile, writeFile, mkdir, readdir, unlink, rename, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { homedir } from 'os'
import { autoUpdater } from 'electron-updater'
import { getConfigPath, loadConfig, saveConfig, getActiveBrandLogo, listBrandLogos, addBrandLogo, setActiveBrandLogo, updateBrandLogo, removeBrandLogo } from './config'

const SOP_EXT = '.sop.json'
const DEFAULT_STORAGE_FOLDER = 'SOPs'

/** If the file has trailing content after one valid JSON object, return just that object's string. */
function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

function getDefaultStoragePath(): string {
  const docs = join(homedir(), 'Documents')
  return join(docs, DEFAULT_STORAGE_FOLDER)
}

let mainWindow: BrowserWindow | null = null
let recordingIndicatorWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let captureHookActive = false
let captureWorkerReadyResolve: (() => void) | null = null
type CaptureImpl = 'iohook' | 'global-mouse-events' | null
let captureImpl: CaptureImpl = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    frame: false,
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.ico')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      devTools: is.dev
    }
  })

  mainWindow = win
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sop-rocket.app')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Storage path
  ipcMain.handle('storage:getPath', async () => {
    const config = loadConfig()
    return config.storagePath ?? getDefaultStoragePath()
  })

  ipcMain.handle('storage:getDefaultPath', async () => getDefaultStoragePath())

  ipcMain.handle('storage:setPath', async (_, path: string) => {
    const config = loadConfig()
    config.storagePath = path
    saveConfig(config)
    if (!existsSync(path)) await mkdir(path, { recursive: true })
    return path
  })

  // Folders (subdirs under storage root) - legacy flat list for compatibility
  ipcMain.handle('storage:listFolders', async () => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    if (!existsSync(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  })

  /** Build tree of folders and SOP files under root. Paths use forward slashes. */
  async function buildTreeAt(root: string, relativePath: string): Promise<Array<{ type: string; name: string; path: string; children?: unknown[] }>> {
    const dir = relativePath ? join(root, relativePath) : root
    if (!existsSync(dir)) return []
    const entries = await readdir(dir, { withFileTypes: true })
    const folders: Array<{ type: 'folder'; name: string; path: string; children: unknown[] }> = []
    const files: Array<{ type: 'file'; name: string; path: string }> = []
    for (const e of entries) {
      if (e.isDirectory()) {
        const path = relativePath ? `${relativePath}/${e.name}` : e.name
        const children = await buildTreeAt(root, path)
        folders.push({ type: 'folder', name: e.name, path, children })
      } else if (e.isFile() && e.name.endsWith(SOP_EXT)) {
        const path = relativePath ? `${relativePath}/${e.name}` : e.name
        files.push({ type: 'file', name: e.name.replace(SOP_EXT, ''), path })
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return [...files, ...folders]
  }

  ipcMain.handle('storage:listTree', async () => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    if (!existsSync(root)) return []
    return buildTreeAt(root, '')
  })

  ipcMain.handle('storage:createFolder', async (_, parentPath: string, name: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const fullPath = parentPath ? join(root, parentPath, name) : join(root, name)
    if (existsSync(fullPath)) throw new Error('Folder already exists')
    await mkdir(fullPath, { recursive: true })
    return parentPath ? `${parentPath}/${name}` : name
  })

  ipcMain.handle('storage:renameFolder', async (_, oldPath: string, newName: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const oldFull = join(root, oldPath)
    const parent = dirname(oldPath)
    const newPath = parent === '.' ? newName : `${parent}/${newName}`
    const newFull = join(root, newPath)
    if (!existsSync(oldFull)) throw new Error('Folder not found')
    if (existsSync(newFull)) throw new Error('Target folder already exists')
    await rename(oldFull, newFull)
    return newPath
  })

  ipcMain.handle('storage:deleteFolder', async (_, path: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const fullPath = join(root, path)
    if (!existsSync(fullPath)) throw new Error('Folder not found')
    await rm(fullPath, { recursive: true })
    return true
  })

  // SOPs: list by folder (empty = root)
  ipcMain.handle('storage:listSOPs', async (_, folderName?: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const dir = folderName ? join(root, folderName) : root
    if (!existsSync(dir)) return []
    const entries = await readdir(dir, { withFileTypes: true })
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(SOP_EXT))
    return files.map((f) => ({
      name: f.name.replace(SOP_EXT, ''),
      path: folderName ? join(folderName, f.name) : f.name
    }))
  })

  ipcMain.handle('storage:loadSOP', async (_, relativePath: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const fullPath = join(root, relativePath)
    let raw = await readFile(fullPath, 'utf-8')
    raw = raw.trim()
    try {
      return JSON.parse(raw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Unexpected non-whitespace character after JSON')) {
        const first = extractFirstJsonObject(raw)
        if (first !== null) return JSON.parse(first)
      }
      throw err
    }
  })

  ipcMain.handle('storage:saveSOP', async (_, relativePath: string, data: unknown) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const fullPath = join(root, relativePath)
    const dir = dirname(fullPath)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })

    const content = JSON.stringify(data, null, 2)
    await writeFile(fullPath, content, 'utf-8')
    return fullPath
  })

  ipcMain.handle('storage:deleteSOP', async (_, relativePath: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const fullPath = join(root, relativePath)
    if (existsSync(fullPath)) await unlink(fullPath)
    return true
  })

  ipcMain.handle('storage:renameSOP', async (_, oldRelativePath: string, newRelativePath: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const oldFull = join(root, oldRelativePath)
    const newFull = join(root, newRelativePath)
    if (!existsSync(oldFull)) throw new Error('SOP not found')
    if (existsSync(newFull)) throw new Error('Target file already exists')
    const content = await readFile(oldFull, 'utf-8')
    const newDir = dirname(newFull)
    if (!existsSync(newDir)) await mkdir(newDir, { recursive: true })
    await writeFile(newFull, content, 'utf-8')
    await unlink(oldFull)
    return newRelativePath
  })

  ipcMain.handle('storage:moveSOP', async (_, fromPath: string, toFolder: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const fromFull = join(root, fromPath)
    const fileName = fromPath.split(/[/\\]/).pop() ?? fromPath
    const toFull = join(root, toFolder, fileName)
    if (!existsSync(fromFull)) throw new Error('SOP not found')
    const toDir = join(toFull, '..')
    if (!existsSync(toDir)) await mkdir(toDir, { recursive: true })
    await rename(fromFull, toFull)
    return join(toFolder, fileName)
  })

  ipcMain.handle('storage:moveFolder', async (_, fromPath: string, toFolder: string) => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    const fromFull = join(root, fromPath)
    const folderName = fromPath.split(/[/\\]/).pop() ?? fromPath
    const toFull = toFolder ? join(root, toFolder, folderName) : join(root, folderName)
    if (!existsSync(fromFull)) throw new Error('Folder not found')
    if (existsSync(toFull)) throw new Error('Target folder already exists')
    if (toFolder === fromPath || (toFolder.startsWith(fromPath) && toFolder.charAt(fromPath.length) === '/')) {
      throw new Error('Cannot move folder into itself')
    }
    const toDir = toFolder ? join(root, toFolder) : root
    if (!existsSync(toDir)) await mkdir(toDir, { recursive: true })
    await rename(fromFull, toFull)
    return toFolder ? `${toFolder}/${folderName}` : folderName
  })

  const LIBRARY_ORDER_FILENAME = '.sop-library-order.json'
  type SortMode = 'alpha' | 'alpha-desc' | 'custom'
  interface LibraryOrder {
    sortMode: SortMode
    customOrderByFolder: Record<string, string[]>
  }
  function getLibraryOrderPath(): string {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    return join(root, LIBRARY_ORDER_FILENAME)
  }
  ipcMain.handle('storage:getLibraryOrder', async (): Promise<LibraryOrder> => {
    const path = getLibraryOrderPath()
    if (!existsSync(path)) {
      return { sortMode: 'alpha', customOrderByFolder: {} }
    }
    try {
      const raw = await readFile(path, 'utf-8')
      const data = JSON.parse(raw) as Partial<LibraryOrder>
      return {
        sortMode: data.sortMode === 'alpha-desc' || data.sortMode === 'custom' ? data.sortMode : 'alpha',
        customOrderByFolder: data.customOrderByFolder && typeof data.customOrderByFolder === 'object' ? data.customOrderByFolder : {}
      }
    } catch {
      return { sortMode: 'alpha', customOrderByFolder: {} }
    }
  })
  ipcMain.handle('storage:setLibraryOrder', async (_, order: LibraryOrder) => {
    const path = getLibraryOrderPath()
    const root = dirname(path)
    if (!existsSync(root)) await mkdir(root, { recursive: true })
    await writeFile(path, JSON.stringify(order, null, 2), 'utf-8')
    return true
  })

  // Ensure storage root exists on first get
  ipcMain.handle('storage:ensureRoot', async () => {
    const config = loadConfig()
    const root = config.storagePath ?? getDefaultStoragePath()
    if (!existsSync(root)) await mkdir(root, { recursive: true })
    return root
  })

  // Config (theme, brand colors)
  ipcMain.handle('config:get', async () => loadConfig())
  ipcMain.handle('config:set', async (_, config: unknown) => {
    saveConfig(config as Parameters<typeof saveConfig>[0])
    return true
  })
  ipcMain.handle('config:getBrandLogo', async () => getActiveBrandLogo())
  ipcMain.handle('config:listBrandLogos', async () => listBrandLogos())
  ipcMain.handle('config:addBrandLogo', async (_, { dataUrl, name }: { dataUrl: string; name?: string }) => addBrandLogo(dataUrl, name))
  ipcMain.handle('config:setActiveBrandLogo', async (_, id: string | null) => setActiveBrandLogo(id))
  ipcMain.handle('config:updateBrandLogo', async (_, id: string, updates: { name?: string }) => updateBrandLogo(id, updates))
  ipcMain.handle('config:removeBrandLogo', async (_, id: string) => removeBrandLogo(id))

  // Save dialog for PDF
  ipcMain.handle('dialog:showSaveDialog', async (_, defaultName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return canceled ? null : filePath
  })


  // Save dialog with custom filters (for multi-format export)
  ipcMain.handle('dialog:showSaveDialogFiltered', async (_, defaultName: string, filters: { name: string; extensions: string[] }[]) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters
    })
    return canceled ? null : filePath
  })

  // Write PDF to path (renderer sends arraybuffer)
  ipcMain.handle('pdf:write', async (_, filePath: string, data: ArrayBuffer) => {
    await writeFile(filePath, Buffer.from(data))
    return filePath
  })

  // Write text to path (for HTML, Markdown exports)
  ipcMain.handle('file:writeText', async (_, filePath: string, text: string) => {
    await writeFile(filePath, text, 'utf-8')
    return filePath
  })

  // Open file dialog and read text content (for import)
  ipcMain.handle('dialog:openFileText', async (_, filters: { name: string; extensions: string[] }[]) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters
    })
    if (canceled || !filePaths.length) return null
    const filePath = filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    const name = filePath.replace(/\\/g, '/').split('/').pop() || ''
    return { content, name, path: filePath }
  })

  // Clipboard image for Paste image (main process has reliable access)
  ipcMain.handle('clipboard:readImage', () => {
    const img = clipboard.readImage()
    return img.isEmpty() ? null : img.toDataURL()
  })

  // Folder picker for storage path
  ipcMain.handle('dialog:showOpenDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return canceled ? null : filePaths?.[0] ?? null
  })

  createWindow()

  // Auto-updater (only when packaged / production)
  if (!is.dev && mainWindow) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('updater:update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes ?? ''
      })
    })
    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('updater:update-downloaded')
    })
    autoUpdater.on('error', (err) => {
      mainWindow?.webContents.send('updater:error', err.message)
    })

    // Check shortly after launch so the window is ready
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    }, 3000)
  }

  ipcMain.handle('updater:checkForUpdates', async () => {
    if (is.dev) return { check: false, message: 'Updates are not checked in development.' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { check: true, update: result?.updateInfo ? { version: result.updateInfo.version, releaseNotes: result.updateInfo.releaseNotes } : null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { check: true, error: message }
    }
  })
  ipcMain.handle('updater:quitAndInstall', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Window controls for frameless title bar (renderer calls these via IPC)
  ipcMain.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.handle('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  ipcMain.handle('window:isMaximized', (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  })

  // --- Auto-capture: global mouse hook and recording indicator ---
  function isPointInWindow(win: BrowserWindow | null, screenX: number, screenY: number): boolean {
    if (!win || win.isDestroyed()) return false
    if (win.isMinimized() || !win.isVisible()) return false
    const b = win.getBounds()
    return screenX >= b.x && screenX < b.x + b.width && screenY >= b.y && screenY < b.y + b.height
  }

  function createRecordingIndicatorWindow(): BrowserWindow | null {
    const primary = screen.getPrimaryDisplay()
    const { width, height } = primary.workAreaSize
    const w = 160
    const h = 48
    const x = width - w - 16
    const y = 16
    const ind = new BrowserWindow({
      width: w,
      height: h,
      x,
      y,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    ind.setMenuBarVisibility(false)
    ind.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a1a;color:#fff;font-family:system-ui,sans-serif;font-size:13px;} .dot{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:pulse 1s ease-in-out infinite;} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style></head><body><span class="dot"></span><span style="margin-left:8px">Recording...</span></body></html>'
      )}`
    )
    return ind
  }

  ipcMain.handle('capture:startRecording', async () => {
    if (captureHookActive) return { ok: true }
  const sendClick = (screenX: number, screenY: number) => {
      if (isPointInWindow(mainWindow, screenX, screenY)) return
      if (isPointInWindow(recordingIndicatorWindow, screenX, screenY)) return
      console.log('[capture] click', screenX, screenY)
      const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY })
      const bounds = display.bounds
      const payload = {
        screenX,
        screenY,
        displayId: display.id,
        displayBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      }
      if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.webContents.send('capture:doCapture', payload)
        console.log('[capture] sent doCapture to capture window')
      } else {
        console.warn('[capture] no capture window')
      }
    }
    if (captureImpl === 'global-mouse-events') {
      try {
        const gme = require('global-mouse-events') as { resumeMouseEvents: () => void }
        gme.resumeMouseEvents()
      } catch (_) {
        captureImpl = null
      }
    } else if (captureImpl === 'iohook') {
      try {
        const iohook = require('iohook') as { start: () => void }
        iohook.start()
      } catch (_) {
        captureImpl = null
      }
    }
    if (captureImpl === null) {
      if (process.platform === 'win32') {
        try {
          const gme = require('global-mouse-events') as {
            on: (event: string, cb: (e: { x: number; y: number; button?: number }) => void) => void
            resumeMouseEvents: () => void
          }
          gme.on('mousedown', (e: { x: number; y: number; button?: number }) => {
            if (e.button !== 1) return
            sendClick(e.x, e.y)
          })
          gme.resumeMouseEvents()
          captureImpl = 'global-mouse-events'
        } catch (_) {
          captureImpl = null
        }
      }
      if (captureImpl === null) {
        let iohook: typeof import('iohook') | null = null
        try {
          iohook = require('iohook')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, error: `Recording not available: could not load global mouse listener. ${process.platform === 'win32' ? 'On Windows, run: npm install global-mouse-events' : 'You may need to run "npm run postinstall" or "electron-rebuild".'}` }
        }
        if (!iohook) return { ok: false, error: 'Global mouse listener not available.' }
        iohook.on('mousedown', (e: { button: number; x: number; y: number }) => {
          if (e.button !== 0) return
          sendClick(e.x, e.y)
        })
        iohook.start()
        captureImpl = 'iohook'
      }
    }
    if (captureImpl === null) {
      return { ok: false, error: 'Recording not available. On Windows try: npm install global-mouse-events' }
    }
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.close()
      captureWindow = null
    }
    const captureReady = new Promise<void>((resolve) => {
      const win = new BrowserWindow({
        width: 100,
        height: 100,
        x: -10000,
        y: -10000,
        show: true,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
          devTools: is.dev
        }
      })
      captureWindow = win
      captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      captureWindow.setAlwaysOnTop(false)
      captureWindow.on('closed', () => {
        captureWindow = null
      })
      const captureUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
        ? `${process.env['ELECTRON_RENDERER_URL']}?capture=1`
        : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}?capture=1`
      console.log('[capture] loading capture window:', captureUrl)
      captureWindow.loadURL(captureUrl).catch((err) => {
        console.error('[capture] capture window load error', err)
        resolve()
      })
      captureWindow.webContents.once('did-finish-load', () => {
        console.log('[capture] capture window did-finish-load')
        resolve()
      })
    })
    await captureReady
    // Wait for the capture worker to register its listener (React mount + useEffect)
    const workerReady = new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        console.warn('[capture] worker ready timeout (5s)')
        if (captureWorkerReadyResolve) {
          captureWorkerReadyResolve()
          captureWorkerReadyResolve = null
        }
        resolve()
      }, 5000)
      captureWorkerReadyResolve = () => {
        clearTimeout(t)
        captureWorkerReadyResolve = null
        resolve()
      }
    })
    await workerReady
    if (!recordingIndicatorWindow || recordingIndicatorWindow.isDestroyed()) {
      recordingIndicatorWindow = createRecordingIndicatorWindow()
    }
    captureHookActive = true
    return { ok: true }
  })

  ipcMain.handle('capture:stopRecording', async () => {
    if (!captureHookActive) return
    if (captureImpl === 'global-mouse-events') {
      try {
        const gme = require('global-mouse-events') as { pauseMouseEvents: () => void }
        gme.pauseMouseEvents()
      } catch (_) {
        /* ignore */
      }
    } else if (captureImpl === 'iohook') {
      try {
        const iohook = require('iohook') as { removeAllListeners: (e: string) => void; stop: () => void }
        iohook.removeAllListeners('mousedown')
        iohook.stop()
      } catch (_) {
        /* ignore */
      }
    }
    captureHookActive = false
    capturePathQueue = []
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.close()
      captureWindow = null
    }
    if (recordingIndicatorWindow && !recordingIndicatorWindow.isDestroyed()) {
      recordingIndicatorWindow.close()
      recordingIndicatorWindow = null
    }
  })

  ipcMain.handle('capture:workerReady', () => {
    if (captureWorkerReadyResolve) {
      console.log('[capture] worker ready')
      captureWorkerReadyResolve()
      captureWorkerReadyResolve = null
    }
  })

  ipcMain.handle('capture:log', (_, message: string) => {
    console.log('[capture]', message)
  })

let capturePathQueue: string[] = []

  ipcMain.handle('capture:captureResult', async (_, result: { dataUrl: string; normalizedClickX: number; normalizedClickY: number }) => {
    console.log('[capture] captureResult received, forwarding to main window')
    if (!mainWindow || mainWindow.isDestroyed()) return
    const imageDataUrl = result.dataUrl
    const match = /^data:image\/\w+;base64,(.+)$/.exec(imageDataUrl)
    const base64 = match ? match[1] : null
    if (!base64) {
      mainWindow.webContents.send('capture:addStepWithImage', { imageDataUrl })
      return
    }
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        mainWindow.show()
        mainWindow.focus()
      }
      const dataUrl = `data:image/png;base64,${base64}`
      const dataUrlJson = JSON.stringify(dataUrl)
      const nx = result.normalizedClickX
      const ny = result.normalizedClickY
      mainWindow.webContents
        .executeJavaScript(
          `(function(){ var d=${dataUrlJson}; var nx=${typeof nx==='number'?nx:0.5}; var ny=${typeof ny==='number'?ny:0.5}; if(window.capture&&window.capture.triggerAddStepByDataUrl){ window.capture.triggerAddStepByDataUrl(d,nx,ny); } })();`
        )
        .then(() => console.log('[capture] executeJavaScript resolved'))
        .catch((e) => console.warn('[capture] executeJavaScript failed', e))
    } catch (e) {
      console.warn('[capture] capture result failed', e)
      mainWindow.webContents.send('capture:addStepWithImage', { imageDataUrl })
    }
  })

  ipcMain.handle('capture:readCapturedImage', async (_, imagePath: string) => {
    try {
      const buf = await readFile(imagePath)
      await unlink(imagePath).catch(() => {})
      const base64 = buf.toString('base64')
      console.log('[capture] readCapturedImage ok, path length', imagePath.length)
      return `data:image/png;base64,${base64}`
    } catch (e) {
      console.warn('[capture] readCapturedImage failed', e)
      return null
    }
  })

  ipcMain.handle('capture:captureFailed', (_, message: string) => {
    console.warn('[capture] capture failed:', message)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('capture:captureError', message)
    }
  })

  ipcMain.handle('capture:getNextCapturePath', () => {
    const path = capturePathQueue.shift() ?? null
    if (path) console.log('[capture] getNextCapturePath returning path, queue now', capturePathQueue.length)
    return path
  })

  ipcMain.handle('capture:getDesktopSources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: typeof (s as unknown as { display_id?: string }).display_id === 'string' ? (s as unknown as { display_id: string }).display_id : ''
    }))
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
