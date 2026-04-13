import { contextBridge, ipcRenderer } from 'electron'

const storage = {
  getPath: () => ipcRenderer.invoke('storage:getPath'),
  getDefaultPath: () => ipcRenderer.invoke('storage:getDefaultPath'),
  setPath: (path: string) => ipcRenderer.invoke('storage:setPath', path),
  ensureRoot: () => ipcRenderer.invoke('storage:ensureRoot'),
  listFolders: () => ipcRenderer.invoke('storage:listFolders'),
  listTree: () => ipcRenderer.invoke('storage:listTree'),
  listSOPs: (folderName?: string) => ipcRenderer.invoke('storage:listSOPs', folderName),
  createFolder: (parentPath: string, name: string) =>
    ipcRenderer.invoke('storage:createFolder', parentPath, name),
  renameFolder: (oldPath: string, newName: string) =>
    ipcRenderer.invoke('storage:renameFolder', oldPath, newName),
  deleteFolder: (path: string) => ipcRenderer.invoke('storage:deleteFolder', path),
  loadSOP: (path: string) => ipcRenderer.invoke('storage:loadSOP', path),
  saveSOP: (path: string, data: unknown) => ipcRenderer.invoke('storage:saveSOP', path, data),
  renameSOP: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke('storage:renameSOP', oldPath, newPath),
  deleteSOP: (path: string) => ipcRenderer.invoke('storage:deleteSOP', path),
  moveSOP: (fromPath: string, toFolder: string) =>
    ipcRenderer.invoke('storage:moveSOP', fromPath, toFolder),
  moveFolder: (fromPath: string, toFolder: string) =>
    ipcRenderer.invoke('storage:moveFolder', fromPath, toFolder),
  getLibraryOrder: () => ipcRenderer.invoke('storage:getLibraryOrder'),
  setLibraryOrder: (order: { sortMode: string; customOrderByFolder: Record<string, string[]> }) =>
    ipcRenderer.invoke('storage:setLibraryOrder', order)
}

const config = {
  get: () => ipcRenderer.invoke('config:get'),
  set: (c: unknown) => ipcRenderer.invoke('config:set', c),
  getBrandLogo: () => ipcRenderer.invoke('config:getBrandLogo') as Promise<string | null>,
  listBrandLogos: () => ipcRenderer.invoke('config:listBrandLogos') as Promise<{ logos: { id: string; name?: string; dataUrl: string }[]; activeId: string | null }>,
  addBrandLogo: (dataUrl: string, name?: string) => ipcRenderer.invoke('config:addBrandLogo', { dataUrl, name }) as Promise<string>,
  setActiveBrandLogo: (id: string | null) => ipcRenderer.invoke('config:setActiveBrandLogo', id) as Promise<void>,
  updateBrandLogo: (id: string, updates: { name?: string }) => ipcRenderer.invoke('config:updateBrandLogo', id, updates) as Promise<void>,
  removeBrandLogo: (id: string) => ipcRenderer.invoke('config:removeBrandLogo', id) as Promise<void>
}

const dialogApi = {
  showSaveDialog: (defaultName: string) => ipcRenderer.invoke('dialog:showSaveDialog', defaultName),
  showSaveDialogFiltered: (defaultName: string, filters: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:showSaveDialogFiltered', defaultName, filters),
  showOpenDirectory: () => ipcRenderer.invoke('dialog:showOpenDirectory')
}

const pdfApi = {
  write: (filePath: string, data: ArrayBuffer) => ipcRenderer.invoke('pdf:write', filePath, data)
}

const fileApi = {
  writeText: (filePath: string, text: string) => ipcRenderer.invoke('file:writeText', filePath, text),
  openFileText: (filters: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:openFileText', filters) as Promise<{ content: string; name: string; path: string } | null>
}

const clipboardApi = {
  readImage: () => ipcRenderer.invoke('clipboard:readImage') as Promise<string | null>
}

const windowApi = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>
}

const updater = {
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates') as Promise<{ check: boolean; update?: { version: string; releaseNotes?: string } | null; error?: string; message?: string }>,
  quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
  onUpdateAvailable: (cb: (data: { version: string; releaseNotes?: string }) => void) => {
    const handler = (_: unknown, data: { version: string; releaseNotes?: string }) => cb(data)
    ipcRenderer.on('updater:update-available', handler)
    return () => { ipcRenderer.removeListener('updater:update-available', handler) }
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on('updater:update-downloaded', cb)
    return () => { ipcRenderer.removeListener('updater:update-downloaded', cb) }
  },
  onUpdateError: (cb: (message: string) => void) => {
    const handler = (_: unknown, message: string) => cb(message)
    ipcRenderer.on('updater:error', handler)
    return () => { ipcRenderer.removeListener('updater:error', handler) }
  }
}

let addStepPathHandler: ((path: string) => void) | null = null
let addStepDataUrlHandler: ((dataUrl: string, normalizedClickX?: number, normalizedClickY?: number) => void) | null = null

const capture = {
  startRecording: () => ipcRenderer.invoke('capture:startRecording') as Promise<{ ok: boolean; error?: string }>,
  stopRecording: () => ipcRenderer.invoke('capture:stopRecording') as Promise<void>,
  getDesktopSources: () => ipcRenderer.invoke('capture:getDesktopSources') as Promise<Array<{ id: string; name: string; display_id: string }>>,
  onGlobalClick: (cb: (payload: { screenX: number; screenY: number; displayId?: number; displayBounds?: { x: number; y: number; width: number; height: number } }) => void) => {
    const handler = (_: unknown, payload: { screenX: number; screenY: number; displayId?: number; displayBounds?: { x: number; y: number; width: number; height: number } }) => cb(payload)
    ipcRenderer.on('capture:globalClick', handler)
    return () => { ipcRenderer.removeListener('capture:globalClick', handler) }
  },
  onDoCaptureRequest: (cb: (payload: { screenX: number; screenY: number; displayId?: number; displayBounds?: { x: number; y: number; width: number; height: number } }) => void) => {
    const handler = (_: unknown, payload: { screenX: number; screenY: number; displayId?: number; displayBounds?: { x: number; y: number; width: number; height: number } }) => cb(payload)
    ipcRenderer.on('capture:doCapture', handler)
    return () => { ipcRenderer.removeListener('capture:doCapture', handler) }
  },
  sendWorkerReady: () => ipcRenderer.invoke('capture:workerReady') as Promise<void>,
  log: (message: string) => ipcRenderer.invoke('capture:log', message) as Promise<void>,
  sendCaptureResult: (result: { dataUrl: string; normalizedClickX: number; normalizedClickY: number }) =>
    ipcRenderer.invoke('capture:captureResult', result) as Promise<void>,
  sendCaptureFailed: (message: string) => ipcRenderer.invoke('capture:captureFailed', message) as Promise<void>,
  onAddStepWithImage: (cb: (data: { imageDataUrl?: string; imagePath?: string }) => void) => {
    const handler = (_: unknown, data: { imageDataUrl?: string; imagePath?: string }) => cb(data)
    ipcRenderer.on('capture:addStepWithImage', handler)
    return () => { ipcRenderer.removeListener('capture:addStepWithImage', handler) }
  },
  readCapturedImage: (imagePath: string) => ipcRenderer.invoke('capture:readCapturedImage', imagePath) as Promise<string | null>,
  getNextCapturePath: () => ipcRenderer.invoke('capture:getNextCapturePath') as Promise<string | null>,
  /** Register handler to add step by image path; called by main via executeJavaScript when IPC send is not processed (e.g. background window). */
  setAddStepPathHandler: (fn: ((path: string) => void) | null) => {
    addStepPathHandler = fn
    ipcRenderer.invoke('capture:log', 'preload setAddStepPathHandler: ' + (fn ? 'function' : 'null')).catch(() => {})
  },
  /** Called from main process via executeJavaScript to add step by path. */
  triggerAddStepByPath: (path: string) => {
    if (typeof addStepPathHandler === 'function') {
      ipcRenderer.invoke('capture:log', 'triggerAddStepByPath calling handler').catch(() => {})
      try {
        addStepPathHandler(path)
      } catch (e) {
        ipcRenderer.invoke('capture:log', 'triggerAddStepByPath handler threw: ' + (e instanceof Error ? e.message : String(e))).catch(() => {})
      }
    } else {
      ipcRenderer.invoke('capture:log', 'triggerAddStepByPath no handler set').catch(() => {})
    }
  },
  setAddStepDataUrlHandler: (fn: ((dataUrl: string, normalizedClickX?: number, normalizedClickY?: number) => void) | null) => {
    addStepDataUrlHandler = fn
    ipcRenderer.invoke('capture:log', 'preload setAddStepDataUrlHandler: ' + (fn ? 'function' : 'null')).catch(() => {})
  },
  /** Called from main via executeJavaScript with image data URL and optional click position (0-1). */
  triggerAddStepByDataUrl: (dataUrl: string, normalizedClickX?: number, normalizedClickY?: number) => {
    if (typeof addStepDataUrlHandler === 'function') {
      ipcRenderer.invoke('capture:log', 'triggerAddStepByDataUrl calling handler').catch(() => {})
      try {
        addStepDataUrlHandler(dataUrl, normalizedClickX, normalizedClickY)
      } catch (e) {
        ipcRenderer.invoke('capture:log', 'triggerAddStepByDataUrl handler threw: ' + (e instanceof Error ? e.message : String(e))).catch(() => {})
      }
    } else {
      ipcRenderer.invoke('capture:log', 'triggerAddStepByDataUrl no handler set').catch(() => {})
    }
  },
  onCaptureError: (cb: (message: string) => void) => {
    const handler = (_: unknown, message: string) => cb(message)
    ipcRenderer.on('capture:captureError', handler)
    return () => { ipcRenderer.removeListener('capture:captureError', handler) }
  },
  onDrainCaptureQueue: (cb: () => void) => {
    ipcRenderer.on('capture:drainQueue', cb)
    return () => ipcRenderer.removeListener('capture:drainQueue', cb)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('storage', storage)
  contextBridge.exposeInMainWorld('config', config)
  contextBridge.exposeInMainWorld('dialogApi', dialogApi)
  contextBridge.exposeInMainWorld('pdfApi', pdfApi)
  contextBridge.exposeInMainWorld('fileApi', fileApi)
  contextBridge.exposeInMainWorld('clipboardApi', clipboardApi)
  contextBridge.exposeInMainWorld('windowApi', windowApi)
  contextBridge.exposeInMainWorld('updater', updater)
  contextBridge.exposeInMainWorld('capture', capture)
}
