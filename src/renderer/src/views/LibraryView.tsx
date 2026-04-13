import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Plus, FolderOpen, FileText, Loader2, Pencil, Trash2, FolderInput } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import type { SOP } from '@shared/types'

interface LibraryViewProps {
  onOpenSOP: (sop: SOP, path: string) => void
  onNewSOP: () => void
}

const ROOT_FOLDER_SENTINEL = '__root__' as const

export function LibraryView({ onOpenSOP, onNewSOP }: LibraryViewProps) {
  const [folders, setFolders] = useState<string[]>([])
  const [sops, setSops] = useState<{ name: string; path: string }[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [rootFolderDisplayName, setRootFolderDisplayName] = useState('My SOPs')
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteFolder, setDeleteFolder] = useState<string | null>(null)
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null)
  const [deleteSOPPath, setDeleteSOPPath] = useState<{ path: string; name: string } | null>(null)
  const [moveSOPPath, setMoveSOPPath] = useState<string | null>(null)

  const loadFolders = useCallback(async () => {
    try {
      const list = await window.storage.listFolders()
      setFolders(list)
    } catch {
      setFolders([])
    }
  }, [])

  const loadSOPs = useCallback(async () => {
    try {
      const list = await window.storage.listSOPs(selectedFolder ?? undefined)
      setSops(list)
    } catch {
      setSops([])
    }
  }, [selectedFolder])

  useEffect(() => {
    window.storage.ensureRoot().finally(() => {
      setLoading(false)
    })
    window.config.get().then((c) => {
      setRootFolderDisplayName(c.rootFolderDisplayName ?? 'My SOPs')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  useEffect(() => {
    loadSOPs()
  }, [loadSOPs])

  const handleOpen = async (path: string) => {
    try {
      const data = await window.storage.loadSOP(path) as SOP
      onOpenSOP(data, path)
    } catch (e) {
      console.error(e)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    setCreating(true)
    try {
      await window.storage.createFolder('', newFolderName.trim())
      setNewFolderName('')
      await loadFolders()
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  const startRename = (name: string) => {
    setRenaming(name)
    setRenameValue(name)
  }

  const submitRename = async () => {
    if (!renaming || !renameValue.trim()) {
      setRenaming(null)
      return
    }
    if (renaming === ROOT_FOLDER_SENTINEL) {
      const name = renameValue.trim()
      if (!name) {
        setRenaming(null)
        return
      }
      try {
        await window.config.set({ ...(await window.config.get()), rootFolderDisplayName: name })
        setRootFolderDisplayName(name)
        setRenaming(null)
      } catch (e) {
        console.error(e)
      }
      return
    }
    if (renameValue.trim() === renaming) {
      setRenaming(null)
      return
    }
    try {
      await window.storage.renameFolder(renaming, renameValue.trim())
      if (selectedFolder === renaming) setSelectedFolder(renameValue.trim())
      setRenaming(null)
      await loadFolders()
    } catch (e) {
      console.error(e)
    }
  }

  const confirmDeleteFolder = async (name: string) => {
    setDeleteFolder(null)
    setDeleteFolderError(null)
    try {
      await window.storage.deleteFolder(name)
      if (selectedFolder === name) setSelectedFolder(null)
      await loadFolders()
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      setDeleteFolderError(raw)
    }
  }

  const handleMoveSOP = async (targetFolder: string) => {
    if (!moveSOPPath) return
    try {
      await window.storage.moveSOP(moveSOPPath, targetFolder)
      setMoveSOPPath(null)
      await loadSOPs()
    } catch (e) {
      console.error(e)
    }
  }

  const confirmDeleteSOP = async () => {
    if (!deleteSOPPath) return
    try {
      await window.storage.deleteSOP(deleteSOPPath.path)
      setDeleteSOPPath(null)
      await loadSOPs()
    } catch (e) {
      console.error(e)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Library</h1>
        <Button onClick={onNewSOP}>
          <Plus className="h-4 w-4 mr-2" />
          New SOP
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <h2 className="text-sm font-medium text-muted-foreground">Folders</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-1 group">
              {renaming === ROOT_FOLDER_SENTINEL ? (
                <>
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitRename()}
                    className="h-8 flex-1"
                    autoFocus
                  />
                  <Button size="sm" onClick={submitRename}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button
                    variant={selectedFolder === null ? 'secondary' : 'ghost'}
                    size="sm"
                    className="flex-1 justify-start"
                    onClick={() => setSelectedFolder(null)}
                  >
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {rootFolderDisplayName}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); setRenaming(ROOT_FOLDER_SENTINEL); setRenameValue(rootFolderDisplayName) }}
                    title="Rename"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
            {folders.map((name) => (
              <div key={name} className="flex items-center gap-1 group">
                {renaming === name ? (
                  <>
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitRename()}
                      className="h-8 flex-1"
                      autoFocus
                    />
                    <Button size="sm" onClick={submitRename}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant={selectedFolder === name ? 'secondary' : 'ghost'}
                      size="sm"
                      className="flex-1 justify-start"
                      onClick={() => setSelectedFolder(name)}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      {name}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); startRename(name) }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteFolder(name) }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="New folder"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
              <Button size="icon" onClick={handleCreateFolder} disabled={creating}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              SOPs {selectedFolder ? `in ${selectedFolder}` : `in ${rootFolderDisplayName}`}
            </h2>
          </CardHeader>
          <CardContent>
            {sops.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No SOPs yet. Create one with New SOP.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {sops.map(({ name, path }) => (
                    <div key={path} className="flex items-center gap-1 group">
                      <Button
                        variant="outline"
                        className="flex-1 justify-start"
                        onClick={() => handleOpen(path)}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        {name}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); setMoveSOPPath(path) }}
                        title="Move to folder"
                      >
                        <FolderInput className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteSOPPath({ path, name }) }}
                        title="Delete SOP"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                {moveSOPPath && (
                  <div className="pt-2 border-t mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground">Move to:</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => handleMoveSOP('')}
                    >
                      {rootFolderDisplayName}
                    </Button>
                    {folders.map((f) => (
                      <Button
                        key={f}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => handleMoveSOP(f)}
                      >
                        {f}
                      </Button>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => setMoveSOPPath(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={!!deleteFolder}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteFolder(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Folder &quot;{deleteFolder}&quot; and everything inside it will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFolder && confirmDeleteFolder(deleteFolder)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteFolderError}
        onOpenChange={(open) => {
          if (!open) setDeleteFolderError(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cannot delete folder</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFolderError}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setDeleteFolderError(null)}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteSOPPath} onOpenChange={(open) => !open && setDeleteSOPPath(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SOP?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteSOPPath?.name}&quot; will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteSOP}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
