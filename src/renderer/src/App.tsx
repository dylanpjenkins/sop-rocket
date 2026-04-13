import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Settings, Minus, Square, X } from 'lucide-react'
import { LibrarySidebar } from '@/views/LibrarySidebar'
import { EditorView } from '@/views/EditorView'
import { SettingsView } from '@/views/SettingsView'
import { EmptyState } from '@/components/EmptyState'
import type { SOP } from '@shared/types'
import lockupLightUrl from '@/assets/lockup-light.svg'
import lockupDarkUrl from '@/assets/lockup-dark.svg'

const SIDEBAR_WIDTH_KEY = 'sop-rocket-sidebar-width'
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 400
const SIDEBAR_DEFAULT = 260

function getStoredSidebarWidth(): number {
  if (typeof localStorage === 'undefined') return SIDEBAR_DEFAULT
  const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
  if (stored == null) return SIDEBAR_DEFAULT
  const n = parseInt(stored, 10)
  if (Number.isNaN(n)) return SIDEBAR_DEFAULT
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n))
}

type View = 'editor' | 'settings'

function applyTheme(theme: string): boolean {
  const root = document.documentElement
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) root.classList.add('dark')
  else root.classList.remove('dark')
  return dark
}

function applyBrandColors(colors: { primary?: string; accent?: string }) {
  const root = document.documentElement
  if (colors.primary) root.style.setProperty('--primary', colors.primary)
  if (colors.accent) root.style.setProperty('--accent', colors.accent)
}

function App() {
  const [view, setView] = useState<View>('editor')
  const [currentSOP, setCurrentSOP] = useState<SOP | null>(null)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [isCreatingNewSOP, setIsCreatingNewSOP] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.config?.get) {
      window.config.get().then((c) => {
        const dark = applyTheme((c?.theme as string) ?? 'light')
        setIsDark(dark)
        applyBrandColors((c?.brandColors as { primary?: string; accent?: string }) ?? {})
      }).catch(() => {})
    }
  }, [])

  const persistSidebarWidth = useCallback((w: number) => {
    setSidebarWidth(w)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w))
    }
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const onMove = (e: PointerEvent) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const x = e.clientX
        const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, x))
        persistSidebarWidth(w)
      })
    }
    const onUp = () => {
      setIsResizing(false)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, persistSidebarWidth])

  const openSOP = (sop: SOP, path: string) => {
    setCurrentSOP(sop)
    setCurrentPath(path)
    setView('editor')
  }

  const newSOP = () => {
    setIsCreatingNewSOP(true)
  }

  const cancelNewSOP = () => {
    setIsCreatingNewSOP(false)
  }

  const createSOPAndOpen = async (name: string, parentFolderPath: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const sanitized = trimmed.replace(/[/\\?%*:|"<>]/g, '-')
    const fileName = `${sanitized}.sop.json`
    const path = parentFolderPath ? `${parentFolderPath}/${fileName}` : fileName
    const now = new Date().toISOString()
    const sop: SOP = {
      id: crypto.randomUUID(),
      title: trimmed,
      steps: [],
      nodes: [],
      createdAt: now,
      updatedAt: now
    }
    await window.storage.saveSOP(path, sop)
    const data = (await window.storage.loadSOP(path)) as SOP
    setCurrentSOP(data)
    setCurrentPath(path)
    setIsCreatingNewSOP(false)
    setView('editor')
    refreshTreeRef.current.refresh()
  }

  const closeEditor = () => {
    setCurrentSOP(null)
    setCurrentPath(null)
  }

  const showSidebar = view !== 'settings'
  const refreshTreeRef = useRef<{ refresh: () => void }>({ refresh: () => {} })

  return (
    <div className="flex h-screen flex-col bg-background">
      <header
        className="flex h-12 shrink-0 items-center border-b bg-background px-0 gap-0 select-none"
        style={{
          WebkitAppRegion: 'drag',
          paddingTop: 'env(safe-area-inset-top, 0px)'
        } as React.CSSProperties}
      >
        <div className="flex flex-1 items-center min-w-0 pl-4">
          <img
            src={isDark ? lockupDarkUrl : lockupLightUrl}
            alt="SOP Rocket"
            className="h-6 w-auto max-w-[200px] object-contain object-left"
          />
        </div>
        <nav className="flex gap-1 items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button
            variant={view === 'settings' ? 'secondary' : 'ghost'}
            size="icon"
            className="rounded-none h-12 w-12"
            onClick={() => setView(view === 'settings' ? 'editor' : 'settings')}
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          {typeof window !== 'undefined' && window.windowApi && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-none h-12 w-10 hover:bg-muted"
                onClick={() => window.windowApi.minimize()}
                title="Minimize"
                aria-label="Minimize"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-none h-12 w-10 hover:bg-muted"
                onClick={() => window.windowApi.maximize()}
                title="Maximize"
                aria-label="Maximize"
              >
                <Square className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-none h-12 w-10 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => window.windowApi.close()}
                title="Close"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </nav>
      </header>
      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <>
            <aside
              className="shrink-0 flex flex-col border-r bg-muted/30"
              style={{ width: sidebarWidth }}
            >
              <LibrarySidebar
                onOpenSOP={openSOP}
                onNewSOP={newSOP}
                currentPath={currentPath}
                isCreatingNewSOP={isCreatingNewSOP}
                onCancelNewSOP={cancelNewSOP}
                onCreateSOP={createSOPAndOpen}
                onRegisterRefresh={(fn) => {
                  refreshTreeRef.current.refresh = fn
                }}
                onSOPDeleted={(path) => {
                  if (path === currentPath) closeEditor()
                }}
                onSOPRenamed={(oldPath, newPath) => {
                  if (currentPath === oldPath) {
                    setCurrentPath(newPath)
                    const newTitle = newPath.replace(/^.*[/\\]/, '').replace(/\.sop\.json$/i, '')
                    setCurrentSOP((prev) => (prev ? { ...prev, title: newTitle } : null))
                  }
                }}
              />
            </aside>
            <div
              role="separator"
              aria-label="Resize sidebar"
              className="w-1.5 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors flex items-stretch"
              onPointerDown={(e) => {
                e.preventDefault()
                const el = e.currentTarget
                if (el) el.setPointerCapture(e.pointerId)
                setIsResizing(true)
              }}
            />
          </>
        )}
        <main className="flex flex-col flex-1 min-h-0 min-w-0 overflow-auto">
          {view === 'settings' && <SettingsView onBack={() => setView('editor')} onThemeChange={setIsDark} />}
          {view === 'editor' && currentPath != null && (
            <EditorView
              key={currentPath}
              initialSOP={currentSOP}
              initialPath={currentPath}
              onClose={closeEditor}
              onSOPSaved={(path) => {
                setCurrentPath(path)
                refreshTreeRef.current.refresh()
              }}
              onSOPChange={setCurrentSOP}
            />
          )}
          {view === 'editor' && currentPath == null && (
            <EmptyState onNewSOP={newSOP} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
