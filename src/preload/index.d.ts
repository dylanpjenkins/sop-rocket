export type TreeItem =
  | { type: 'folder'; name: string; path: string; children: TreeItem[] }
  | { type: 'file'; name: string; path: string }

export interface StorageAPI {
  getPath: () => Promise<string>
  getDefaultPath: () => Promise<string>
  setPath: (path: string) => Promise<string>
  ensureRoot: () => Promise<string>
  listFolders: () => Promise<string[]>
  listTree: () => Promise<TreeItem[]>
  listSOPs: (folderName?: string) => Promise<{ name: string; path: string }[]>
  createFolder: (parentPath: string, name: string) => Promise<string>
  renameFolder: (oldPath: string, newName: string) => Promise<string>
  deleteFolder: (path: string) => Promise<boolean>
  loadSOP: (path: string) => Promise<unknown>
  saveSOP: (path: string, data: unknown) => Promise<string>
  renameSOP: (oldPath: string, newPath: string) => Promise<string>
  deleteSOP: (path: string) => Promise<boolean>
  moveSOP: (fromPath: string, toFolder: string) => Promise<string>
  moveFolder: (fromPath: string, toFolder: string) => Promise<string>
  getLibraryOrder: () => Promise<LibraryOrder>
  setLibraryOrder: (order: LibraryOrder) => Promise<boolean>
}

export type { LibraryOrder } from '@shared/types'

export interface BrandLogoEntry {
  id: string
  name?: string
  dataUrl: string
}

export interface ConfigAPI {
  get: () => Promise<{
    theme: string
    brandColors: Record<string, string>
    storagePath?: string
    stepBackgroundColor?: string
    stepNumberIconBgColor?: string
    stepNumberIconTextColor?: string
    rootFolderDisplayName?: string
  }>
  set: (c: unknown) => Promise<boolean>
  getBrandLogo: () => Promise<string | null>
  listBrandLogos: () => Promise<{ logos: BrandLogoEntry[]; activeId: string | null }>
  addBrandLogo: (dataUrl: string, name?: string) => Promise<string>
  setActiveBrandLogo: (id: string | null) => Promise<void>
  updateBrandLogo: (id: string, updates: { name?: string }) => Promise<void>
  removeBrandLogo: (id: string) => Promise<void>
}

declare global {
  interface Window {
    storage: StorageAPI
    config: ConfigAPI
    dialogApi: {
      showSaveDialog: (defaultName: string) => Promise<string | null>
      showSaveDialogFiltered: (defaultName: string, filters: { name: string; extensions: string[] }[]) => Promise<string | null>
      showOpenDirectory: () => Promise<string | null>
    }
    pdfApi: { write: (filePath: string, data: ArrayBuffer) => Promise<string> }
    fileApi: {
      writeText: (filePath: string, text: string) => Promise<string>
      openFileText: (filters: { name: string; extensions: string[] }[]) => Promise<{ content: string; name: string; path: string } | null>
    }
    clipboardApi: { readImage: () => Promise<string | null> }
    windowApi: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
    }
    updater?: {
      checkForUpdates: () => Promise<{ check: boolean; update?: { version: string; releaseNotes?: string } | null; error?: string; message?: string }>
      quitAndInstall: () => Promise<void>
      onUpdateAvailable: (cb: (data: { version: string; releaseNotes?: string }) => void) => () => void
      onUpdateDownloaded: (cb: () => void) => () => void
      onUpdateError: (cb: (message: string) => void) => () => void
    }
    capture?: {
      startRecording: () => Promise<{ ok: boolean; error?: string }>
      stopRecording: () => Promise<void>
      getDesktopSources: () => Promise<Array<{ id: string; name: string; display_id: string }>>
      onGlobalClick: (cb: (payload: { screenX: number; screenY: number; displayId?: number; displayBounds?: { x: number; y: number; width: number; height: number } }) => void) => () => void
      onDoCaptureRequest: (cb: (payload: { screenX: number; screenY: number; displayId?: number; displayBounds?: { x: number; y: number; width: number; height: number } }) => void) => () => void
      sendWorkerReady: () => Promise<void>
      log: (message: string) => Promise<void>
      sendCaptureResult: (result: { dataUrl: string; normalizedClickX: number; normalizedClickY: number }) => Promise<void>
      sendCaptureFailed: (message: string) => Promise<void>
      onAddStepWithImage: (cb: (data: { imageDataUrl?: string; imagePath?: string }) => void) => () => void
      readCapturedImage: (imagePath: string) => Promise<string | null>
      getNextCapturePath: () => Promise<string | null>
      setAddStepPathHandler: (fn: ((path: string) => void) | null) => void
      triggerAddStepByPath: (path: string) => void
      setAddStepDataUrlHandler: (fn: ((dataUrl: string, normalizedClickX?: number, normalizedClickY?: number) => void) | null) => void
      triggerAddStepByDataUrl: (dataUrl: string, normalizedClickX?: number, normalizedClickY?: number) => void
      onCaptureError: (cb: (message: string) => void) => () => void
      onDrainCaptureQueue: (cb: () => void) => () => void
    }
  }
}
