import { useState, useEffect, useCallback, Fragment, useRef, useMemo, type RefObject } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import type { PointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  FolderOpen,
  Folder,
  FileText,
  Loader2,
  ChevronRight,
  ArrowDownAZ,
  ArrowUpAZ,
  Search,
  X
} from 'lucide-react'
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
import type { SOP, TreeItem, LibrarySortMode } from '@shared/types'

const ROOT_DROP_ID = '__root__'

/** Offset the drag overlay to the right so the drop guideline remains visible under the cursor. */
const DRAG_OVERLAY_OFFSET_X = 100
function offsetDragOverlayToRight({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) {
  return { ...transform, x: transform.x + DRAG_OVERLAY_OFFSET_X }
}

/** Max ms between two clicks to count as double-click for starting rename (user must click quicker). */
const DOUBLE_CLICK_MS = 300

/** Only activates on left click so right-click context menu works on nested folders. */
class LeftClickPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: PointerEvent, { onActivation }: { onActivation?: (props: { event: Event }) => void }) => {
        if (event.button !== 0) return false
        onActivation?.({ event })
        return true
      }
    }
  ]
}

/** Reorder tree by sort mode and optional custom order. Files always above folders. */
function applyLibraryOrder(
  tree: TreeItem[],
  sortMode: LibrarySortMode,
  customOrderByFolder: Record<string, string[]>
): TreeItem[] {
  function partition(children: TreeItem[]): { files: TreeItem[]; folders: TreeItem[] } {
    const files: TreeItem[] = []
    const folders: TreeItem[] = []
    for (const c of children) {
      if (c.type === 'file') files.push(c)
      else folders.push(c)
    }
    return { files, folders }
  }

  function orderGroup(items: TreeItem[], folderPath: string, pathsInOrder: string[] | undefined): TreeItem[] {
    if (items.length === 0) return items
    if (sortMode === 'alpha') return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    if (sortMode === 'alpha-desc') return [...items].sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }))
    if (!pathsInOrder || pathsInOrder.length === 0) return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const byPath = new Map(items.map((c) => [c.path, c]))
    const ordered: TreeItem[] = []
    for (const path of pathsInOrder) {
      const node = byPath.get(path)
      if (node) {
        ordered.push(node)
        byPath.delete(path)
      }
    }
    byPath.forEach((node) => ordered.push(node))
    return ordered
  }

  function orderChildren(folderPath: string, children: TreeItem[]): TreeItem[] {
    if (children.length === 0) return children
    const { files, folders } = partition(children)
    const order = customOrderByFolder[folderPath]
    const fileOrder = order ? order.filter((p) => files.some((f) => f.path === p)) : undefined
    const folderOrder = order ? order.filter((p) => folders.some((f) => f.path === p)) : undefined
    const orderedFiles = orderGroup(files, folderPath, fileOrder)
    const orderedFolders = orderGroup(folders, folderPath, folderOrder)
    return [...orderedFiles, ...orderedFolders]
  }

  function mapNode(item: TreeItem, parentPath: string): TreeItem {
    if (item.type === 'file') return item
    const ordered = orderChildren(item.path, item.children)
    return {
      ...item,
      children: ordered.map((child) => mapNode(child, item.path))
    }
  }
  const rootOrdered = orderChildren('', tree)
  return rootOrdered.map((item) => mapNode(item, ''))
}

/** Get direct children of a folder from the tree. parentPath '' = root. */
function getChildrenForFolder(items: TreeItem[], parentPath: string): TreeItem[] {
  if (parentPath === '') return items
  for (const item of items) {
    if (item.type === 'folder' && item.path === parentPath) return item.children
    if (item.type === 'folder') {
      const inside = getChildrenForFolder(item.children, parentPath)
      if (inside.length > 0) return inside
    }
  }
  return []
}

/** Collect all file (SOP) paths from the tree. */
function getAllFilePaths(items: TreeItem[]): string[] {
  const paths: string[] = []
  for (const item of items) {
    if (item.type === 'file') paths.push(item.path)
    else paths.push(...getAllFilePaths(item.children))
  }
  return paths
}

/** Flatten tree to paths in display order (depth-first, files then folders per level). */
function flattenDisplayOrder(items: TreeItem[]): string[] {
  const out: string[] = []
  for (const item of items) {
    out.push(item.path)
    if (item.type === 'folder') {
      out.push(...flattenDisplayOrder(item.children))
    }
  }
  return out
}

/** Find item by path in tree. */
function getItemByPath(items: TreeItem[], path: string): TreeItem | null {
  for (const item of items) {
    if (item.path === path) return item
    if (item.type === 'folder') {
      const found = getItemByPath(item.children, path)
      if (found) return found
    }
  }
  return null
}

/** Compute a unique path for a copy in the same folder: "Name.sop.json" -> "Name copy.sop.json", then "Name copy 2.sop.json", etc. */
function getUniqueCopyPath(originalPath: string, existingPaths: string[]): string {
  const normalized = originalPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const fileName = parts.pop() ?? originalPath
  const dir = parts.length > 0 ? parts.join('/') : ''
  const baseName = fileName.replace(/\.sop\.json$/i, '')
  const siblingNames = new Set(
    existingPaths
      .map((p) => p.replace(/\\/g, '/'))
      .filter((p) => {
        const pDir = p.includes('/') ? p.replace(/\/[^/]+$/, '') : ''
        return pDir === dir
      })
      .map((p) => p.split('/').pop() ?? '')
  )
  let candidateName = `${baseName} copy.sop.json`
  let n = 2
  while (siblingNames.has(candidateName)) {
    candidateName = `${baseName} copy ${n}.sop.json`
    n += 1
  }
  return dir ? `${dir}/${candidateName}` : candidateName
}

function DropSlot({ slotId }: { slotId: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: slotId })
  return (
    <div
      ref={setNodeRef}
      className="min-h-[8px] flex-shrink-0 flex items-center py-0.5"
      style={{ marginLeft: 4 }}
    >
      {isOver && (
        <div className="h-0.5 w-full rounded-full bg-primary" style={{ minHeight: 2 }} />
      )}
    </div>
  )
}

interface LibrarySidebarProps {
  onOpenSOP: (sop: SOP, path: string) => void
  onNewSOP: () => void
  currentPath: string | null
  isCreatingNewSOP?: boolean
  onCancelNewSOP?: () => void
  onCreateSOP?: (name: string, parentFolderPath: string) => void | Promise<void>
  onRegisterRefresh?: (fn: () => void) => void
  onSOPDeleted?: (path: string) => void
  onSOPRenamed?: (oldPath: string, newPath: string) => void
}

export function LibrarySidebar({
  onOpenSOP,
  onNewSOP,
  currentPath,
  isCreatingNewSOP,
  onCancelNewSOP,
  onCreateSOP,
  onRegisterRefresh,
  onSOPDeleted,
  onSOPRenamed
}: LibrarySidebarProps) {
  const newSOPInputRef = useRef<HTMLInputElement>(null)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  const loadTreeIdRef = useRef(0)
  const [tree, setTree] = useState<TreeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [rootFolderDisplayName, setRootFolderDisplayName] = useState('My SOPs')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteFolderPath, setDeleteFolderPath] = useState<string | null>(null)
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null)
  const [deleteSOPPath, setDeleteSOPPath] = useState<{ path: string; name: string } | null>(null)
  const [selectedItemPaths, setSelectedItemPaths] = useState<Set<string>>(new Set())
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null)
  const [deleteTargets, setDeleteTargets] = useState<Array<{ path: string; type: 'folder' | 'file'; name: string }> | null>(null)
  const [deleteTargetsError, setDeleteTargetsError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    type: 'folder'
    path: string
  } | {
    x: number
    y: number
    type: 'file'
    path: string
    name: string
  } | {
    x: number
    y: number
    type: 'blank'
  } | null>(null)
  const [newFolderParentPath, setNewFolderParentPath] = useState<string | null>(null)
  const [newSOPName, setNewSOPName] = useState('')
  const [renamingFilePath, setRenamingFilePath] = useState<string | null>(null)
  const [renameFileValue, setRenameFileValue] = useState('')
  const [libraryOrder, setLibraryOrder] = useState<{ sortMode: LibrarySortMode; customOrderByFolder: Record<string, string[]> }>({
    sortMode: 'alpha',
    customOrderByFolder: {}
  })
  const [activeDrag, setActiveDrag] = useState<{ id: string; path: string; type: 'file' | 'folder'; name: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchResults, setSearchResults] = useState<Array<{ path: string; name: string }> | null>(null)
  const sopCacheRef = useRef<Map<string, { title: string; subtitle?: string; stepTitles: string[] }>>(new Map())

  const collectFiles = useCallback((items: TreeItem[]): Array<{ path: string; name: string }> => {
    const files: Array<{ path: string; name: string }> = []
    for (const item of items) {
      if (item.type === 'file') files.push({ path: item.path, name: item.name })
      else if (item.type === 'folder' && item.children) files.push(...collectFiles(item.children))
    }
    return files
  }, [])

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults(null); return }
    const q = query.toLowerCase()
    const allFiles = collectFiles(tree)
    const matches: Array<{ path: string; name: string }> = []
    for (const file of allFiles) {
      // Check filename first
      if (file.name.toLowerCase().includes(q)) { matches.push(file); continue }
      // Check cached SOP content
      let cached = sopCacheRef.current.get(file.path)
      if (!cached) {
        try {
          const sop = (await window.storage.loadSOP(file.path)) as SOP | null
          if (sop) {
            const stepTitles = (sop.nodes ?? sop.steps.map(s => ({ ...s, type: 'step' as const })))
              .filter((n: any) => n.type === 'step')
              .map((n: any) => n.title || '')
            cached = { title: sop.title, subtitle: sop.subtitle, stepTitles }
            sopCacheRef.current.set(file.path, cached)
          }
        } catch { /* skip */ }
      }
      if (cached) {
        const haystack = [cached.title, cached.subtitle ?? '', ...cached.stepTitles].join(' ').toLowerCase()
        if (haystack.includes(q)) matches.push(file)
      }
    }
    setSearchResults(matches)
  }, [tree, collectFiles])

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!searchQuery.trim()) { setSearchResults(null); return }
    searchTimerRef.current = setTimeout(() => runSearch(searchQuery), 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery, runSearch])

  const displayedTree = useMemo(
    () => applyLibraryOrder(tree, libraryOrder.sortMode, libraryOrder.customOrderByFolder),
    [tree, libraryOrder.sortMode, libraryOrder.customOrderByFolder]
  )

  useEffect(() => {
    if (isCreatingNewSOP) {
      setNewSOPName('')
      const t = setTimeout(() => newSOPInputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [isCreatingNewSOP])

  const loadTree = useCallback(async () => {
    const id = ++loadTreeIdRef.current
    try {
      await window.storage.ensureRoot()
      const [list, order] = await Promise.all([
        window.storage.listTree(),
        window.storage.getLibraryOrder()
      ])
      if (id !== loadTreeIdRef.current) return
      setTree(list)
      setLibraryOrder(order)
    } catch {
      if (id !== loadTreeIdRef.current) return
      setTree([])
    } finally {
      if (id === loadTreeIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTree()
    window.config.get().then((c) => {
      setRootFolderDisplayName(c.rootFolderDisplayName ?? 'My SOPs')
    }).catch(() => {})
  }, [loadTree])

  useEffect(() => {
    onRegisterRefresh?.(loadTree)
  }, [onRegisterRefresh, loadTree])

  useEffect(() => {
    if (selectedItemPaths.size > 0) treeContainerRef.current?.focus()
  }, [selectedItemPaths.size])

  // Document-level capture listener so folder context menu runs before dnd-kit or other listeners
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent): void => {
      const target = e.target as Element
      const row = target.closest('[data-folder-row]')
      if (!row) return
      const content = row.querySelector('[data-folder-row-content]')
      if (!content || !content.contains(target)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const path = row.getAttribute('data-folder-path')
      if (path != null) {
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', path })
      }
    }
    document.addEventListener('contextmenu', handleContextMenu, true)
    return () => document.removeEventListener('contextmenu', handleContextMenu, true)
  }, [])

  const handleOpen = async (path: string) => {
    try {
      await loadTree()
      const data = (await window.storage.loadSOP(path)) as SOP
      onOpenSOP(data, path)
    } catch (e) {
      console.error(e)
    }
  }

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleAddFolder = () => {
    setNewFolderParentPath('')
    setExpanded((prev) => new Set(prev))
    setRenamingPath(ROOT_DROP_ID)
    setRenameValue('')
  }

  const submitRenameFolder = async () => {
    if (renamingPath === ROOT_DROP_ID) {
      await handleCreateFolder()
      return
    }
    if (!renamingPath) {
      setRenamingPath(null)
      return
    }
    if (!renameValue.trim()) {
      setRenamingPath(null)
      return
    }
    const currentName = renamingPath.split('/').pop() ?? ''
    if (renameValue.trim() === currentName) {
      setRenamingPath(null)
      return
    }
    try {
      await window.storage.renameFolder(renamingPath, renameValue.trim())
      setRenamingPath(null)
      setRenameValue('')
      await loadTree()
    } catch (e) {
      console.error(e)
    }
  }

  const handleCreateFolder = async () => {
    const parent = newFolderParentPath ?? ''
    if (!renameValue.trim()) {
      setRenamingPath(null)
      setNewFolderParentPath(null)
      return
    }
    try {
      await window.storage.createFolder(parent, renameValue.trim())
      setRenamingPath(null)
      setNewFolderParentPath(null)
      setRenameValue('')
      await loadTree()
    } catch (e) {
      console.error(e)
    }
  }

  const startRenameFolder = (path: string, currentName: string) => {
    setRenamingPath(path)
    setRenameValue(currentName)
  }

  const startRenameFile = (path: string, currentName: string) => {
    setRenamingFilePath(path)
    setRenameFileValue(currentName)
  }

  const submitRenameFile = async () => {
    if (!renamingFilePath || !renameFileValue.trim()) {
      setRenamingFilePath(null)
      setRenameFileValue('')
      return
    }
    const trimmed = renameFileValue.trim().replace(/[/\\?%*:|"<>]/g, '-')
    if (!trimmed) {
      setRenamingFilePath(null)
      setRenameFileValue('')
      return
    }
    const sep = renamingFilePath.includes('/') ? '/' : '\\'
    const parts = renamingFilePath.split(sep)
    parts.pop()
    const dir = parts.length > 0 ? parts.join('/') : ''
    const newFileName = `${trimmed}.sop.json`
    const newPath = dir ? `${dir}/${newFileName}` : newFileName
    if (newPath === renamingFilePath) {
      setRenamingFilePath(null)
      setRenameFileValue('')
      return
    }
    try {
      const result = await window.storage.renameSOP(renamingFilePath, newPath)
      const sop = (await window.storage.loadSOP(result)) as SOP
      await window.storage.saveSOP(result, { ...sop, title: trimmed })
      onSOPRenamed?.(renamingFilePath, result)
      setRenamingFilePath(null)
      setRenameFileValue('')
      await loadTree()
    } catch (e) {
      console.error(e)
    }
  }

  const cancelRenameFile = () => {
    setRenamingFilePath(null)
    setRenameFileValue('')
  }

  const flattenedOrder = useMemo(() => flattenDisplayOrder(displayedTree), [displayedTree])

  const handleSelect = useCallback(
    (path: string, type: 'folder' | 'file', name: string, e: React.MouseEvent) => {
      const shift = e.shiftKey
      const ctrlOrMeta = e.ctrlKey || e.metaKey

      if (ctrlOrMeta) {
        setSelectedItemPaths((prev) => {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
        setLastSelectedPath(path)
        if (type === 'folder') setSelectedFolderPath(path)
        return
      }

      if (shift) {
        const ordered = flattenedOrder
        const idx = ordered.indexOf(path)
        const anchorIdx = lastSelectedPath != null ? ordered.indexOf(lastSelectedPath) : -1
        const start = anchorIdx >= 0 ? Math.min(anchorIdx, idx) : idx
        const end = anchorIdx >= 0 ? Math.max(anchorIdx, idx) : idx
        setSelectedItemPaths((prev) => {
          const next = new Set(prev)
          for (let i = start; i <= end; i++) next.add(ordered[i])
          return next
        })
        setLastSelectedPath(path)
        if (type === 'folder') setSelectedFolderPath(path)
        return
      }

      setSelectedItemPaths(new Set([path]))
      setLastSelectedPath(path)
      if (type === 'folder') {
        setSelectedFolderPath(path)
      } else {
        setSelectedFolderPath(null)
        handleOpen(path)
      }
    },
    [flattenedOrder, lastSelectedPath]
  )

  const confirmDeleteTargets = async () => {
    if (!deleteTargets || deleteTargets.length === 0) return
    const targets = [...deleteTargets]
    setDeleteTargets(null)
    setDeleteTargetsError(null)
    const folders = targets.filter((t) => t.type === 'folder')
    const files = targets.filter((t) => t.type === 'file')
    folders.sort((a, b) => b.path.length - a.path.length)
    try {
      for (const { path } of folders) {
        await window.storage.deleteFolder(path)
      }
      for (const { path } of files) {
        await window.storage.deleteSOP(path)
        onSOPDeleted?.(path)
      }
      setSelectedItemPaths(new Set())
      setLastSelectedPath(null)
      await loadTree()
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      setDeleteTargetsError(raw)
      setDeleteTargets(targets)
    }
  }

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleDuplicateSOP = useCallback(
    async (path: string) => {
      try {
        const sop = (await window.storage.loadSOP(path)) as SOP
        const existingPaths = getAllFilePaths(displayedTree)
        const newPath = getUniqueCopyPath(path, existingPaths)
        const newFileName = newPath.replace(/^.*[/\\]/, '').replace(/\.sop\.json$/i, '')
        const now = new Date().toISOString()
        const duplicate: SOP = {
          ...sop,
          id: crypto.randomUUID(),
          title: newFileName,
          createdAt: now,
          updatedAt: now
        }
        await window.storage.saveSOP(newPath, duplicate)
        closeContextMenu()
        await loadTree()
      } catch (e) {
        console.error(e)
      }
    },
    [displayedTree, loadTree, closeContextMenu]
  )

  const toggleSortOrder = useCallback(async () => {
    const nextMode: LibrarySortMode = libraryOrder.sortMode === 'alpha-desc' ? 'alpha' : 'alpha-desc'
    const next = { ...libraryOrder, sortMode: nextMode }
    setLibraryOrder(next)
    try {
      await window.storage.setLibraryOrder(next)
    } catch (e) {
      console.error(e)
    }
  }, [libraryOrder])

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDrag(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromPath = active.data.current?.path as string | undefined
    const itemType = active.data.current?.type as 'file' | 'folder' | undefined
    if (!fromPath || typeof fromPath !== 'string') return

    const overId = String(over.id)
    let toFolder: string
    let slotIndex: number | undefined

    if (overId.startsWith('slot:')) {
      const parts = overId.split(':')
      if (parts.length < 2) return
      slotIndex = parseInt(parts[parts.length - 1], 10)
      if (Number.isNaN(slotIndex)) return
      toFolder = parts.slice(1, -1).join(':') ?? ''
    } else {
      toFolder = overId === ROOT_DROP_ID ? '' : overId
    }

    const dir = fromPath.includes('/') ? fromPath.replace(/[/\\][^/\\]+$/, '') : ''
    const sameFolder = dir === toFolder

    if (sameFolder && slotIndex !== undefined) {
      const children = getChildrenForFolder(displayedTree, toFolder)
      const paths = children.map((c) => c.path)
      const fromIndex = paths.indexOf(fromPath)
      if (fromIndex === -1) return
      const newPaths = paths.filter((p) => p !== fromPath)
      newPaths.splice(Math.min(slotIndex, newPaths.length), 0, fromPath)
      const nextCustom = { ...libraryOrder.customOrderByFolder, [toFolder]: newPaths }
      const next = { sortMode: 'custom' as const, customOrderByFolder: nextCustom }
      setLibraryOrder(next)
      try {
        await window.storage.setLibraryOrder(next)
      } catch (e) {
        console.error(e)
      }
      return
    }

    if (itemType === 'folder') {
      if (toFolder === fromPath || (toFolder.startsWith(fromPath + '/') || toFolder.startsWith(fromPath + '\\'))) return
      try {
        await window.storage.moveFolder(fromPath, toFolder)
        await loadTree()
      } catch (e) {
        console.error(e)
      }
      return
    }

    if (toFolder === fromPath) return
    if (sameFolder) return

    try {
      await window.storage.moveSOP(fromPath, toFolder)
      await loadTree()
    } catch (e) {
      console.error(e)
    }
  }

  const sensors = useSensors(
    useSensor(LeftClickPointerSensor as unknown as typeof PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const data = active.data.current
    const path = data?.path as string | undefined
    const type = data?.type as 'file' | 'folder' | undefined
    const name = data?.name as string | undefined
    if (path && type && name) {
      setActiveDrag({ id: String(active.id), path, type, name })
    }
  }, [])

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as Node
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLElement && target.isContentEditable) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedItemPaths.size === 0) return
      e.preventDefault()
      const targets: Array<{ path: string; type: 'folder' | 'file'; name: string }> = []
      for (const path of selectedItemPaths) {
        const item = getItemByPath(displayedTree, path)
        if (item) targets.push({ path: item.path, type: item.type, name: item.name })
      }
      if (targets.length > 0) setDeleteTargets(targets)
    },
    [selectedItemPaths, displayedTree]
  )

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 border-b px-2 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-1 border-b px-2 py-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onNewSOP}
              title="New SOP"
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleAddFolder}
              title="New folder"
            >
              <Folder className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleSortOrder}
              title={libraryOrder.sortMode === 'alpha-desc' ? 'Sort A–Z' : 'Sort Z–A'}
            >
              {libraryOrder.sortMode === 'alpha-desc' ? (
                <ArrowUpAZ className="h-4 w-4" />
              ) : (
                <ArrowDownAZ className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="px-2 py-1.5 border-b shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search SOPs..."
                className="h-7 pl-7 pr-7 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setSearchResults(null) }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          {searchResults !== null ? (
            <div className="flex-1 overflow-auto py-1">
              {searchResults.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-4 text-center">No results found</p>
              ) : (
                searchResults.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm hover:bg-accent/50 ${currentPath === file.path ? 'bg-accent' : ''}`}
                    onClick={async () => {
                      const sop = (await window.storage.loadSOP(file.path)) as SOP | null
                      if (sop) onOpenSOP(sop, file.path)
                    }}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{file.name.replace(/\.sop\.json$/i, '')}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
          <div
            ref={treeContainerRef}
            className="flex-1 overflow-auto py-1 outline-none"
            tabIndex={0}
            onKeyDown={handleTreeKeyDown}
            onContextMenu={(e) => {
              const target = e.target as Element
              if (target.closest('[data-folder-row], [data-file-row]')) return
              e.preventDefault()
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'blank' })
            }}
          >
            <TreeRoot
              rootDisplayName={rootFolderDisplayName}
              items={displayedTree}
              expanded={expanded}
              selectedFolderPath={selectedFolderPath}
              currentPath={currentPath}
              isCreatingNewSOP={isCreatingNewSOP}
              newSOPName={newSOPName}
              newSOPInputRef={newSOPInputRef}
              onNewSOPNameChange={setNewSOPName}
              onSubmitNewSOP={() => {
                const name = newSOPName.trim()
                if (name && onCreateSOP) {
                  onCreateSOP(name, selectedFolderPath ?? '')
                } else if (onCancelNewSOP) {
                  onCancelNewSOP()
                }
              }}
              onCancelNewSOP={onCancelNewSOP}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onToggleExpand={toggleExpand}
              onSelectFolder={(path) => {
                setSelectedFolderPath(path)
                if (path == null) setSelectedItemPaths(new Set())
              }}
              onOpenFile={handleOpen}
              onRenameFolder={startRenameFolder}
              onDeleteFolder={(path) => {
                const item = getItemByPath(displayedTree, path)
                if (item) setDeleteTargets([{ path: item.path, type: item.type, name: item.name }])
              }}
              onDeleteSOP={(payload) => setDeleteTargets([{ path: payload.path, type: 'file', name: payload.name }])}
              selectedItemPaths={selectedItemPaths}
              onSelect={handleSelect}
              onContextMenuFolder={(e, path) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', path })
              }}
              onContextMenuFile={(e, path, name) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', path, name })
              }}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRenameFolder}
              onRenameCancel={() => {
                setRenamingPath(null)
                setNewFolderParentPath(null)
              }}
              renamingFilePath={renamingFilePath}
              renameFileValue={renameFileValue}
              onStartRenameFile={startRenameFile}
              onRenameFileChange={setRenameFileValue}
              onSubmitRenameFile={submitRenameFile}
              onCancelRenameFile={cancelRenameFile}
              depth={0}
            />
          </div>
          )}
          <DragOverlay dropAnimation={null} modifiers={[offsetDragOverlayToRight]}>
            {activeDrag ? (
              <div className="flex items-center gap-1.5 min-h-7 rounded px-2 py-1 bg-background border border-border shadow-lg text-sm cursor-grabbing">
                {activeDrag.type === 'file' ? (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate max-w-[200px]">{activeDrag.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </div>
      </DndContext>

      <AlertDialog
        open={!!deleteTargets}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargets(null)
            setDeleteTargetsError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTargets && deleteTargets.length === 1
                ? deleteTargets[0].type === 'folder'
                  ? 'Delete folder?'
                  : 'Delete SOP?'
                : `Delete ${deleteTargets?.length ?? 0} items?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTargets && deleteTargets.length === 1 ? (
                deleteTargets[0].type === 'folder' ? (
                  <>Folder &quot;{deleteTargets[0].name}&quot; and everything inside it will be permanently deleted. This cannot be undone.</>
                ) : (
                  <>SOP &quot;{deleteTargets[0].name}&quot; will be permanently deleted. This cannot be undone.</>
                )
              ) : deleteTargets && deleteTargets.length > 1 ? (
                <>
                  {deleteTargets.filter((t) => t.type === 'folder').length} folder(s) and{' '}
                  {deleteTargets.filter((t) => t.type === 'file').length} SOP(s) will be permanently deleted. This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteTargets}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteTargetsError}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetsError(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cannot delete</AlertDialogTitle>
            <AlertDialogDescription>{deleteTargetsError}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setDeleteTargetsError(null)}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeContextMenu()
            }}
          />
          <div
            className="fixed z-50 min-w-[140px] rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.type === 'blank' && (
              <>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground outline-none flex items-center gap-2"
                  onClick={() => {
                    onNewSOP()
                    closeContextMenu()
                  }}
                >
                  <FileText className="h-4 w-4" />
                  New SOP
                </button>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground outline-none flex items-center gap-2"
                  onClick={() => {
                    handleAddFolder()
                    closeContextMenu()
                  }}
                >
                  <Folder className="h-4 w-4" />
                  New folder
                </button>
              </>
            )}
            {contextMenu.type === 'folder' && (
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground outline-none"
                onClick={() => {
                  setSelectedFolderPath(contextMenu.path)
                  setSelectedItemPaths((prev) => new Set(prev).add(contextMenu.path))
                  setExpanded((prev) => new Set(prev).add(contextMenu.path))
                  onNewSOP?.()
                  closeContextMenu()
                }}
              >
                New SOP
              </button>
            )}
            {contextMenu.type === 'file' && (
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground outline-none"
                onClick={() => {
                  handleDuplicateSOP(contextMenu.path)
                }}
              >
                Duplicate
              </button>
            )}
            {(contextMenu.type === 'folder' || contextMenu.type === 'file') && (
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-destructive focus:bg-accent focus:text-accent-foreground outline-none"
                onClick={() => {
                  if (contextMenu.type === 'folder') {
                    setDeleteTargets([{ path: contextMenu.path, type: 'folder', name: contextMenu.path.split('/').pop() ?? contextMenu.path }])
                  } else {
                    setDeleteTargets([{ path: contextMenu.path, type: 'file', name: contextMenu.name }])
                  }
                  closeContextMenu()
                }}
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}

interface TreeRootProps {
  rootDisplayName: string
  items: TreeItem[]
  expanded: Set<string>
  selectedFolderPath: string | null
  currentPath: string | null
  isCreatingNewSOP?: boolean
  newSOPName: string
  newSOPInputRef: RefObject<HTMLInputElement | null>
  onNewSOPNameChange: (value: string) => void
  onSubmitNewSOP: () => void
  onCancelNewSOP?: () => void
  renamingPath: string | null
  renameValue: string
  onToggleExpand: (path: string) => void
  onSelectFolder: (path: string | null) => void
  onOpenFile: (path: string) => void
  onRenameFolder: (path: string, name: string) => void
  onDeleteFolder: (path: string) => void
  onDeleteSOP: (payload: { path: string; name: string }) => void
  selectedItemPaths: Set<string>
  onSelect: (path: string, type: 'folder' | 'file', name: string, e: React.MouseEvent) => void
  onContextMenuFolder: (e: React.MouseEvent, path: string) => void
  onContextMenuFile: (e: React.MouseEvent, path: string, name: string) => void
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  renamingFilePath: string | null
  renameFileValue: string
  onStartRenameFile: (path: string, name: string) => void
  onRenameFileChange: (value: string) => void
  onSubmitRenameFile: () => void
  onCancelRenameFile: () => void
  depth: number
}

function TreeRoot({
  rootDisplayName,
  items,
  expanded,
  selectedFolderPath,
  currentPath,
  isCreatingNewSOP,
  newSOPName,
  newSOPInputRef,
  onNewSOPNameChange,
  onSubmitNewSOP,
  onCancelNewSOP,
  renamingPath,
  renameValue,
  onToggleExpand,
  onSelectFolder,
  onOpenFile,
  onRenameFolder,
  onDeleteFolder,
  onDeleteSOP,
  selectedItemPaths,
  onSelect,
  onContextMenuFolder,
  onContextMenuFile,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  renamingFilePath,
  renameFileValue,
  onStartRenameFile,
  onRenameFileChange,
  onSubmitRenameFile,
  onCancelRenameFile,
  depth
}: TreeRootProps) {
  const { setNodeRef } = useDroppable({ id: ROOT_DROP_ID })
  const isNewFolderInput = renamingPath === ROOT_DROP_ID

  const handleNewSOPBlur = () => {
    if (newSOPName.trim()) {
      onSubmitNewSOP()
    } else {
      onCancelNewSOP?.()
    }
  }

  return (
    <div ref={setNodeRef}>
      {isNewFolderInput && (
        <div className="flex items-center gap-0.5 min-h-7 rounded px-1 py-0.5 bg-primary/15" style={{ paddingLeft: 4 }}>
          <span className="p-0.5 shrink-0 text-muted-foreground" aria-hidden>
            <ChevronRight className="h-4 w-4" />
          </span>
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={() => {
              if (renameValue.trim()) onRenameSubmit()
              else onRenameCancel()
            }}
            className="h-7 text-sm flex-1 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            placeholder="New folder name"
            autoFocus
          />
        </div>
      )}
      {isCreatingNewSOP && !selectedFolderPath && (
        <div className="flex items-center gap-1.5 min-h-7 rounded px-1 py-0.5 bg-primary/15" style={{ paddingLeft: 26 }}>
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={newSOPInputRef as React.Ref<HTMLInputElement>}
            value={newSOPName}
            onChange={(e) => onNewSOPNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (newSOPName.trim()) onSubmitNewSOP()
                else onCancelNewSOP?.()
              }
              if (e.key === 'Escape') onCancelNewSOP?.()
            }}
            onBlur={handleNewSOPBlur}
            placeholder="SOP title"
            className="h-7 text-sm flex-1 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}
      {items.map((item, i) => (
        <Fragment key={item.path}>
          <DropSlot slotId={`slot::${i}`} />
          <TreeNode
            item={item}
            expanded={expanded}
            selectedFolderPath={selectedFolderPath}
            currentPath={currentPath}
            isCreatingNewSOP={isCreatingNewSOP}
            newSOPName={newSOPName}
            newSOPInputRef={newSOPInputRef}
            onNewSOPNameChange={onNewSOPNameChange}
            onSubmitNewSOP={onSubmitNewSOP}
            onCancelNewSOP={onCancelNewSOP}
            renamingPath={renamingPath}
            renameValue={renameValue}
      onToggleExpand={onToggleExpand}
      onSelectFolder={onSelectFolder}
      onOpenFile={onOpenFile}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
      onDeleteSOP={onDeleteSOP}
      selectedItemPaths={selectedItemPaths}
      onSelect={onSelect}
      onContextMenuFolder={onContextMenuFolder}
            onContextMenuFile={onContextMenuFile}
            onRenameChange={onRenameChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            renamingFilePath={renamingFilePath}
            renameFileValue={renameFileValue}
            onStartRenameFile={onStartRenameFile}
            onRenameFileChange={onRenameFileChange}
            onSubmitRenameFile={onSubmitRenameFile}
            onCancelRenameFile={onCancelRenameFile}
            depth={depth}
          />
        </Fragment>
      ))}
      <DropSlot slotId={`slot::${items.length}`} />
    </div>
  )
}

interface TreeNodeProps {
  item: TreeItem
  expanded: Set<string>
  selectedFolderPath: string | null
  currentPath: string | null
  isCreatingNewSOP?: boolean
  newSOPName: string
  newSOPInputRef: RefObject<HTMLInputElement | null>
  onNewSOPNameChange: (value: string) => void
  onSubmitNewSOP: () => void
  onCancelNewSOP?: () => void
  renamingPath: string | null
  renameValue: string
  onToggleExpand: (path: string) => void
  onSelectFolder: (path: string | null) => void
  onOpenFile: (path: string) => void
  onRenameFolder: (path: string, name: string) => void
  onDeleteFolder: (path: string) => void
  onDeleteSOP: (payload: { path: string; name: string }) => void
  selectedItemPaths: Set<string>
  onSelect: (path: string, type: 'folder' | 'file', name: string, e: React.MouseEvent) => void
  onContextMenuFolder: (e: React.MouseEvent, path: string) => void
  onContextMenuFile: (e: React.MouseEvent, path: string, name: string) => void
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  renamingFilePath: string | null
  renameFileValue: string
  onStartRenameFile: (path: string, name: string) => void
  onRenameFileChange: (value: string) => void
  onSubmitRenameFile: () => void
  onCancelRenameFile: () => void
  depth: number
}

function TreeNode({
  item,
  expanded,
  selectedFolderPath,
  currentPath,
  isCreatingNewSOP,
  newSOPName,
  newSOPInputRef,
  onNewSOPNameChange,
  onSubmitNewSOP,
  onCancelNewSOP,
  renamingPath,
  renameValue,
  onToggleExpand,
  onSelectFolder,
  onOpenFile,
  onRenameFolder,
  onDeleteFolder,
  onDeleteSOP,
  selectedItemPaths,
  onSelect,
  onContextMenuFolder,
  onContextMenuFile,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  renamingFilePath,
  renameFileValue,
  onStartRenameFile,
  onRenameFileChange,
  onSubmitRenameFile,
  onCancelRenameFile,
  depth
}: TreeNodeProps) {
  const paddingLeft = depth * 12 + 4
  /** Extra indent so file icon aligns with folder icon (folder has chevron + icon before name). */
  const filePaddingLeft = paddingLeft + 22

  if (item.type === 'file') {
    return (
      <FileRow
        path={item.path}
        name={item.name}
        isActive={currentPath === item.path}
        isSelected={selectedItemPaths.has(item.path)}
        paddingLeft={filePaddingLeft}
        onOpen={() => onOpenFile(item.path)}
        onSelect={(e) => onSelect(item.path, 'file', item.name, e)}
        onContextMenu={(e) => onContextMenuFile(e, item.path, item.name)}
        isRenaming={renamingFilePath === item.path}
        renameFileValue={renameFileValue}
        onStartRename={onStartRenameFile}
        onRenameFileChange={onRenameFileChange}
        onSubmitRenameFile={onSubmitRenameFile}
        onCancelRenameFile={onCancelRenameFile}
      />
    )
  }

  const isExpanded = expanded.has(item.path)
  const isSelected = selectedItemPaths.has(item.path)
  const isRenaming = renamingPath === item.path

  return (
    <FolderRow
      path={item.path}
      name={item.name}
      children={item.children}
      isExpanded={isExpanded}
      isSelected={isSelected}
      isRenaming={isRenaming}
      renameValue={renameValue}
      paddingLeft={paddingLeft}
      expanded={expanded}
      selectedFolderPath={selectedFolderPath}
      currentPath={currentPath}
      renamingPath={renamingPath}
      isCreatingNewSOP={isCreatingNewSOP}
      newSOPName={newSOPName}
      newSOPInputRef={newSOPInputRef}
      onNewSOPNameChange={onNewSOPNameChange}
      onSubmitNewSOP={onSubmitNewSOP}
      onCancelNewSOP={onCancelNewSOP}
      onToggleExpand={onToggleExpand}
      onSelectRow={(e) => onSelect(item.path, 'folder', item.name, e)}
      onSelectFolder={onSelectFolder}
      onOpenFile={onOpenFile}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
      onDeleteSOP={onDeleteSOP}
      selectedItemPaths={selectedItemPaths}
      onSelect={onSelect}
      onContextMenuFolder={onContextMenuFolder}
      onContextMenuFile={onContextMenuFile}
      onRenameChange={onRenameChange}
      onRenameSubmit={onRenameSubmit}
      onRenameCancel={onRenameCancel}
      renamingFilePath={renamingFilePath}
      renameFileValue={renameFileValue}
      onStartRenameFile={onStartRenameFile}
      onRenameFileChange={onRenameFileChange}
      onSubmitRenameFile={onSubmitRenameFile}
      onCancelRenameFile={onCancelRenameFile}
      depth={depth}
    />
  )
}

function FileRow({
  path,
  name,
  isActive,
  isSelected,
  paddingLeft,
  onOpen,
  onSelect,
  onContextMenu,
  isRenaming,
  renameFileValue,
  onStartRename,
  onRenameFileChange,
  onSubmitRenameFile,
  onCancelRenameFile
}: {
  path: string
  name: string
  isActive: boolean
  isSelected: boolean
  paddingLeft: number
  onOpen: () => void
  onSelect: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  isRenaming: boolean
  renameFileValue: string
  onStartRename: (path: string, name: string) => void
  onRenameFileChange: (value: string) => void
  onSubmitRenameFile: () => void
  onCancelRenameFile: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: path,
    data: { path, type: 'file', name }
  })
  const lastClickRef = useRef<{ time: number; path: string } | null>(null)

  const handleFileClick = (e: React.MouseEvent) => {
    const now = Date.now()
    const last = lastClickRef.current
    if (last?.path === path && now - last.time <= DOUBLE_CLICK_MS) {
      lastClickRef.current = null
      onStartRename(path, name)
      return
    }
    lastClickRef.current = { time: now, path }
    onSelect(e)
  }

  return (
    <div
      ref={setNodeRef}
      data-file-row
      data-file-path={path}
      style={{ paddingLeft: `${paddingLeft}px` }}
      className={`group flex items-center gap-0.5 min-h-7 rounded px-1 hover:bg-muted/80 ${isRenaming ? '' : 'cursor-grab active:cursor-grabbing'} ${isActive ? 'bg-primary/15' : ''} ${isSelected ? 'bg-muted' : ''} ${isDragging ? 'opacity-50' : ''}`}
      {...(isRenaming ? {} : { ...listeners, ...attributes })}
    >
      {isRenaming ? (
        <div className="flex items-center gap-1.5 min-w-0 flex-1 py-0.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={renameFileValue}
            onChange={(e) => onRenameFileChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitRenameFile()
              if (e.key === 'Escape') onCancelRenameFile()
            }}
            className="h-7 text-sm min-w-[80px] max-w-full border-0 border-none outline-none shadow-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none px-0 py-0 bg-transparent"
            style={{ width: `${Math.max(8, Math.min(renameFileValue.length + 1, 40))}ch` }}
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-sm py-0.5"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleFileClick(e)
          }}
          onContextMenu={onContextMenu}
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
      )}
    </div>
  )
}

interface FolderRowProps {
  path: string
  name: string
  children: TreeItem[]
  isExpanded: boolean
  isSelected: boolean
  isRenaming: boolean
  renameValue: string
  paddingLeft: number
  expanded: Set<string>
  selectedFolderPath: string | null
  currentPath: string | null
  renamingPath: string | null
  isCreatingNewSOP?: boolean
  newSOPName: string
  newSOPInputRef: RefObject<HTMLInputElement | null>
  onNewSOPNameChange: (value: string) => void
  onSubmitNewSOP: () => void
  onCancelNewSOP?: () => void
  onToggleExpand: (path: string) => void
  onSelectRow: (e: React.MouseEvent) => void
  onSelectFolder: (path: string | null) => void
  onOpenFile: (path: string) => void
  onRenameFolder: (path: string, name: string) => void
  onDeleteFolder: (path: string) => void
  onDeleteSOP: (payload: { path: string; name: string }) => void
  selectedItemPaths: Set<string>
  onSelect: (path: string, type: 'folder' | 'file', name: string, e: React.MouseEvent) => void
  onContextMenuFolder: (e: React.MouseEvent, path: string) => void
  onContextMenuFile: (e: React.MouseEvent, path: string, name: string) => void
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  renamingFilePath: string | null
  renameFileValue: string
  onStartRenameFile: (path: string, name: string) => void
  onRenameFileChange: (value: string) => void
  onSubmitRenameFile: () => void
  onCancelRenameFile: () => void
  depth: number
}

function FolderRow({
  path,
  name,
  children,
  isExpanded,
  isSelected,
  isRenaming,
  renameValue,
  paddingLeft,
  expanded,
  selectedFolderPath,
  currentPath,
  renamingPath,
  isCreatingNewSOP,
  newSOPName,
  newSOPInputRef,
  onNewSOPNameChange,
  onSubmitNewSOP,
  onCancelNewSOP,
  onToggleExpand,
  onSelectRow,
  onSelectFolder,
  onOpenFile,
  onRenameFolder,
  onDeleteFolder,
  onDeleteSOP,
  selectedItemPaths,
  onSelect,
  onContextMenuFolder,
  onContextMenuFile,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  renamingFilePath,
  renameFileValue,
  onStartRenameFile,
  onRenameFileChange,
  onSubmitRenameFile,
  onCancelRenameFile,
  depth
}: FolderRowProps) {
  const { setNodeRef: setDroppableRef } = useDroppable({ id: path })
  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: `folder:${path}`,
    data: { path, type: 'folder' as const, name }
  })
  const lastClickRef = useRef<{ time: number; path: string } | null>(null)

  const setNodeRef = (node: HTMLDivElement | null) => {
    setDroppableRef(node)
    setDraggableRef(node)
  }

  const handleFolderNameClick = (e: React.MouseEvent) => {
    const now = Date.now()
    const last = lastClickRef.current
    if (last?.path === path && now - last.time <= DOUBLE_CLICK_MS) {
      lastClickRef.current = null
      onRenameFolder(path, name)
      return
    }
    lastClickRef.current = { time: now, path }
    onSelectRow(e)
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) onToggleExpand(path)
  }

  return (
    <div
      ref={setNodeRef}
      data-folder-row
      data-folder-path={path}
      onContextMenuCapture={(e) => {
        const rowContent = e.currentTarget?.querySelector('[data-folder-row-content]')
        if (!rowContent || !rowContent.contains(e.target as Node)) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenuFolder(e, path)
      }}
    >
      <div
        data-folder-row-content
        style={{ paddingLeft: `${paddingLeft}px` }}
        className={`group flex items-center gap-0.5 min-h-7 rounded px-1 hover:bg-muted/80 ${isSelected ? 'bg-muted' : ''} ${isRenaming ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'opacity-50' : ''}`}
        {...(isRenaming ? {} : { ...listeners, ...attributes })}
      >
        {isRenaming ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1 py-0.5">
            <span className="p-0.5 shrink-0 text-muted-foreground" aria-hidden>
              <ChevronRight
                className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </span>
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Input
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameSubmit()
                if (e.key === 'Escape') onRenameCancel()
              }}
              onBlur={onRenameSubmit}
              className="h-7 text-sm min-w-[80px] max-w-full border-0 border-none outline-none shadow-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none px-0 py-0 bg-transparent"
              style={{ width: `${Math.max(8, Math.min(renameValue.length + 1, 40))}ch` }}
              autoFocus
            />
          </div>
        ) : (
          <>
            <button
              type="button"
              className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onToggleExpand(path)}
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </button>
            <button
              type="button"
              className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-sm py-0.5"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleFolderNameClick(e)
              }}
              onContextMenu={(e) => onContextMenuFolder(e, path)}
            >
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{name}</span>
            </button>
          </>
        )}
      </div>
      {isExpanded && (
        <div>
          {isCreatingNewSOP && path === selectedFolderPath && (
            <div className="flex items-center gap-1.5 min-h-7 rounded px-1 py-0.5 bg-primary/15" style={{ paddingLeft: (depth + 1) * 12 + 26 }}>
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                ref={newSOPInputRef as React.Ref<HTMLInputElement>}
                value={newSOPName}
                onChange={(e) => onNewSOPNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (newSOPName.trim()) onSubmitNewSOP()
                    else onCancelNewSOP?.()
                  }
                  if (e.key === 'Escape') onCancelNewSOP?.()
                }}
                onBlur={() => {
                  if (newSOPName.trim()) onSubmitNewSOP()
                  else onCancelNewSOP?.()
                }}
                placeholder="SOP title"
                className="h-7 text-sm flex-1 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          )}
          {children.map((child, i) => (
            <Fragment key={child.path}>
              <DropSlot slotId={`slot:${path}:${i}`} />
              <TreeNode
                item={child}
                expanded={expanded}
                selectedFolderPath={selectedFolderPath}
                currentPath={currentPath}
                isCreatingNewSOP={isCreatingNewSOP}
                newSOPName={newSOPName}
                newSOPInputRef={newSOPInputRef}
                onNewSOPNameChange={onNewSOPNameChange}
                onSubmitNewSOP={onSubmitNewSOP}
                onCancelNewSOP={onCancelNewSOP}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onToggleExpand={onToggleExpand}
                onSelectFolder={onSelectFolder}
                onOpenFile={onOpenFile}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                onDeleteSOP={onDeleteSOP}
                selectedItemPaths={selectedItemPaths}
                onSelect={onSelect}
                onContextMenuFolder={onContextMenuFolder}
                onContextMenuFile={onContextMenuFile}
                onRenameChange={onRenameChange}
                onRenameSubmit={onRenameSubmit}
                onRenameCancel={onRenameCancel}
                renamingFilePath={renamingFilePath}
                renameFileValue={renameFileValue}
                onStartRenameFile={onStartRenameFile}
                onRenameFileChange={onRenameFileChange}
                onSubmitRenameFile={onSubmitRenameFile}
                onCancelRenameFile={onCancelRenameFile}
                depth={depth + 1}
              />
            </Fragment>
          ))}
          <DropSlot slotId={`slot:${path}:${children.length}`} />
        </div>
      )}
    </div>
  )
}
