import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FolderOpen, ImagePlus, X, RotateCcw, Check, Pencil, ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import type { ThemeMode } from '@shared/types'

const DEFAULTS = {
  theme: 'light' as ThemeMode,
  brandAccentColor: '#ffffff'
}

function RevertButton({ onClick, title = 'Reset to default' }: { onClick: () => void; title?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <RotateCcw className="h-4 w-4" />
    </Button>
  )
}

export function SettingsView({ onBack, onThemeChange }: { onBack?: () => void; onThemeChange?: (isDark: boolean) => void }) {
  const [storagePath, setStoragePath] = useState('')
  const [defaultStoragePath, setDefaultStoragePath] = useState('')
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [configLoaded, setConfigLoaded] = useState(false)
  const [brandAccentColor, setBrandAccentColor] = useState('')
  const [brandLogos, setBrandLogos] = useState<{ id: string; name?: string; dataUrl: string }[]>([])
  const [activeLogoId, setActiveLogoId] = useState<string | null>(null)
  const [editingLogoId, setEditingLogoId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const logoInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Update check state (only when updater is available, e.g. packaged app)
  const [updateCheckStatus, setUpdateCheckStatus] = useState<'idle' | 'checking' | 'available' | 'downloaded' | 'error' | 'no-update'>('idle')

  const refreshBrandLogos = () => {
    window.config.listBrandLogos().then(({ logos, activeId }) => {
      setBrandLogos(logos)
      setActiveLogoId(activeId)
    })
  }

  useEffect(() => {
    window.storage.getPath().then(setStoragePath)
    if (typeof window.storage.getDefaultPath === 'function') {
      window.storage.getDefaultPath().then(setDefaultStoragePath)
    }
    window.config.get().then((c) => {
      setTheme((c.theme as ThemeMode) ?? DEFAULTS.theme)
      setBrandAccentColor(c.stepNumberIconBgColor ?? DEFAULTS.brandAccentColor)
      setConfigLoaded(true)
    })
    refreshBrandLogos()
  }, [])

  // Subscribe to updater events (push from main process)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.updater) return
    const unsubAvailable = window.updater.onUpdateAvailable(() => {
      setUpdateCheckStatus('available')
    })
    const unsubDownloaded = window.updater.onUpdateDownloaded(() => {
      setUpdateCheckStatus('downloaded')
    })
        const unsubError = window.updater.onUpdateError(() => {
      setUpdateCheckStatus('error')
    })
    return () => {
      unsubAvailable()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  const handleCheckForUpdates = async () => {
    if (typeof window === 'undefined' || !window.updater) return
    setUpdateCheckStatus('checking')
    try {
      const result = await window.updater.checkForUpdates()
      if (result.update) {
        setUpdateCheckStatus('available')
      } else if (result.error) {
        setUpdateCheckStatus('error')
      } else {
        setUpdateCheckStatus('no-update')
      }
    } catch {
      setUpdateCheckStatus('error')
    }
  }

  const handleChangePath = async () => {
    const path = await window.dialogApi.showOpenDirectory()
    if (path) {
      await window.storage.setPath(path)
      setStoragePath(path)
    }
  }


  const saveTheme = (value: ThemeMode) => {
    setTheme(value)
    window.config.get().then((c) => {
      window.config.set({ ...c, theme: value })
      const dark = value === 'dark' || (value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
      onThemeChange?.(dark)
    })
  }

  const saveBrandAccentColor = (value?: string) => {
    const toSave = value ?? (brandAccentColor || DEFAULTS.brandAccentColor)
    window.config.get().then((c) => {
      window.config.set({
        ...c,
        stepNumberIconBgColor: toSave
      })
    })
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file?.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      window.config.addBrandLogo(dataUrl).then(() => refreshBrandLogos())
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const setActiveLogo = (id: string) => {
    window.config.setActiveBrandLogo(id).then(() => setActiveLogoId(id))
  }

  const removeLogo = (id: string) => {
    window.config.removeBrandLogo(id).then(() => refreshBrandLogos())
  }

  const startRename = (logo: { id: string; name?: string; dataUrl: string }, index: number) => {
    setEditingLogoId(logo.id)
    setEditingName(logo.name || `Logo ${index + 1}`)
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  const saveRename = (id: string) => {
    if (editingLogoId !== id) return
    const name = editingName.trim() || undefined
    window.config.updateBrandLogo(id, { name }).then(() => {
      refreshBrandLogos()
      setEditingLogoId(null)
      setEditingName('')
    })
  }

  const cancelRename = () => {
    setEditingLogoId(null)
    setEditingName('')
  }

  const revertStoragePath = () => {
    window.config.get().then((c) => {
      const { storagePath: _, ...rest } = c as { storagePath?: string; [k: string]: unknown }
      return window.config.set(rest)
    }).then(() => window.storage.getPath().then(setStoragePath))
  }

  const revertTheme = () => saveTheme(DEFAULTS.theme)

  const revertBrandAccentColor = () => {
    setBrandAccentColor(DEFAULTS.brandAccentColor)
    window.config.get().then((c) => {
      window.config.set({ ...c, stepNumberIconBgColor: DEFAULTS.brandAccentColor })
    })
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {onBack && (
        <Button variant="ghost" size="sm" className="-ml-2 gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Storage location</CardTitle>
            {defaultStoragePath && storagePath !== defaultStoragePath && (
              <RevertButton onClick={revertStoragePath} />
            )}
          </div>
          <CardDescription>Default: Documents/SOPs. SOP files are stored here.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input value={storagePath} readOnly className="font-mono text-sm" />
          <Button variant="outline" size="icon" onClick={handleChangePath}>
            <FolderOpen className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>App theme</CardTitle>
            {configLoaded && theme !== DEFAULTS.theme && (
              <RevertButton onClick={revertTheme} />
            )}
          </div>
          <CardDescription>Light, dark, or follow system.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {configLoaded
            ? (['light', 'dark', 'system'] as const).map((t) => (
                <Button
                  key={t}
                  variant={theme === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => saveTheme(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Button>
              ))
            : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled>
                    Light
                  </Button>
                  <Button variant="outline" size="sm" disabled>
                    Dark
                  </Button>
                  <Button variant="outline" size="sm" disabled>
                    System
                  </Button>
                </div>
              )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>
            Accent color is used for step number icons in the editor and PDF export (text adjusts for contrast). The selected logo appears in the top right of exported PDFs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Accent color</span>
              {brandAccentColor !== DEFAULTS.brandAccentColor && (
                <RevertButton onClick={revertBrandAccentColor} title="Reset to default (#ffffff)" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                value={brandAccentColor || DEFAULTS.brandAccentColor}
                onChange={(e) => {
                  const v = e.target.value
                  setBrandAccentColor(v)
                  saveBrandAccentColor(v)
                }}
                className="w-14 h-10 p-1 cursor-pointer"
              />
              <Input
                value={brandAccentColor}
                onChange={(e) => setBrandAccentColor(e.target.value)}
                onBlur={() => saveBrandAccentColor()}
                placeholder={DEFAULTS.brandAccentColor}
                className="flex-1 font-mono max-w-[140px]"
              />
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-sm font-medium">Brand logo</div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoChange}
            />
            {brandLogos.length > 0 ? (
              <ul className="space-y-3">
                {brandLogos.map((logo, index) => (
                  <li
                    key={logo.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20"
                  >
                    <img
                      src={logo.dataUrl}
                      alt={logo.name ?? 'Brand logo'}
                      className="h-14 w-auto max-w-[160px] object-contain border rounded bg-muted/30 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      {editingLogoId === logo.id ? (
                        <Input
                          ref={renameInputRef}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => saveRename(logo.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(logo.id)
                            if (e.key === 'Escape') cancelRename()
                          }}
                          className="h-8 text-sm"
                          placeholder="Logo name"
                        />
                      ) : (
                        <>
                          <span className="text-sm font-medium truncate block">
                            {logo.name || `Logo ${index + 1}`}
                          </span>
                          {activeLogoId === logo.id && (
                            <span className="text-xs text-muted-foreground">In use</span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {editingLogoId !== logo.id && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startRename(logo, index)}
                            title="Rename logo"
                            aria-label="Rename logo"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {activeLogoId !== logo.id && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setActiveLogo(logo.id)}
                              title="Use this logo"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLogo(logo.id)}
                            className="text-destructive hover:text-destructive"
                            title="Remove logo"
                            aria-label="Remove logo"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button variant="outline" onClick={() => logoInputRef.current?.click()}>
              <ImagePlus className="h-4 w-4 mr-2" />
              Upload logo
            </Button>
          </div>
        </CardContent>
      </Card>

      {typeof window !== 'undefined' && window.updater && (
        <Card>
          <CardHeader>
            <CardTitle>Updates</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleCheckForUpdates}
              disabled={updateCheckStatus === 'checking'}
            >
              {updateCheckStatus === 'checking' ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Check for updates
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
