/** Circle annotation on a step image */
export interface CircleAnnotation {
  cx: number
  cy: number
  r: number
  strokeWidth: number
  color: string
}

/** Arrow annotation on a step image (normalized 0-1) */
export interface ArrowAnnotation {
  x1: number
  y1: number
  x2: number
  y2: number
  strokeWidth: number
  color: string
}

/** Ellipse annotation on a step image (normalized 0-1) */
export interface EllipseAnnotation {
  cx: number
  cy: number
  rx: number
  ry: number
  strokeWidth: number
  color: string
}

/** Blur or redact region annotation (normalized 0-1) */
export interface BlurAnnotation {
  /** Top-left x (normalized 0-1) */
  x: number
  /** Top-left y (normalized 0-1) */
  y: number
  /** Width (normalized 0-1) */
  w: number
  /** Height (normalized 0-1) */
  h: number
  /** 'redact' fills with solid color */
  mode: 'redact'
  /** Redact fill color (default black) */
  color?: string
}

export interface StepAnnotations {
  circles: CircleAnnotation[]
  arrows?: ArrowAnnotation[]
  ellipses?: EllipseAnnotation[]
  blurs?: BlurAnnotation[]
}

/** A single step in an SOP */
export interface Step {
  id: string
  title: string
  /** Rich text body/description (Tiptap JSON string). Optional. */
  description?: string
  imageUrl: string // base64 data URL or blob URL (legacy / first image)
  /** When set, step has one or more images; imageUrl mirrors first for backward compat */
  imageUrls?: string[]
  /** Rows of images for layout; row 0 = main row. When set, imageUrls/imageUrl are synced from this. */
  imageRows?: string[][]
  annotations: StepAnnotations
}

/** Discriminator for instruction nodes in an SOP */
export type InstructionNodeType = 'step' | 'tip'

/** Tip callout color variant: neutral (blue), helpful (green), warning (red) */
export type TipVariant = 'neutral' | 'warning' | 'success'

/** Step node (numbered step with optional images and annotations) */
export interface StepNode extends Step {
  type: 'step'
  /** Indent level: 0 = top-level step, 1+ = sub-step. Defaults to 0. */
  indent?: number
}

/** Tip callout node (callout box with optional color variant) */
export interface TipNode {
  type: 'tip'
  id: string
  text: string
  variant: TipVariant
}

export type InstructionNode = StepNode | TipNode

/** Type guard: node is a step */
export function isStepNode(node: InstructionNode): node is StepNode {
  return node.type === 'step'
}

/** Type guard: node is a tip */
export function isTipNode(node: InstructionNode): node is TipNode {
  return node.type === 'tip'
}

/** Full SOP document */
export interface SOP {
  id: string
  title: string
  /** Optional subtitle shown under the title on the document */
  subtitle?: string
  /** Text direction: 'ltr' (default) or 'rtl' */
  dir?: 'ltr' | 'rtl'
  /** How this SOP is built: manual (add/drop/paste screenshots) or auto-capture (record clicks). Default 'manual'. */
  buildMode?: 'manual' | 'auto-capture'
  steps: Step[]
  /** Ordered list of instruction nodes (steps, tips). When absent, derived from steps. */
  nodes?: InstructionNode[]
  createdAt: string // ISO
  updatedAt: string // ISO
}

/** Returns the ordered instruction nodes for a SOP. Uses nodes if present; otherwise derives from steps. Filters out legacy subheading nodes. */
export function getInstructionNodes(sop: SOP): InstructionNode[] {
  const raw = sop.nodes != null
    ? sop.nodes
    : sop.steps.map((step) => ({ ...step, type: 'step' as const }))
  return raw.filter((n): n is InstructionNode => n.type === 'step' || n.type === 'tip')
}

/** Returns steps array for persistence (subset of nodes that are steps, without type discriminator). */
export function getStepsFromNodes(sop: SOP): Step[] {
  return getInstructionNodes(sop)
    .filter(isStepNode)
    .map(({ type: _t, ...step }) => step)
}

/**
 * Compute display labels for step nodes, e.g., "1", "1a", "1b", "2".
 * Steps with indent >= 1 are sub-steps of the preceding top-level step.
 */
export function computeStepLabels(nodes: InstructionNode[]): Map<string, string> {
  const labels = new Map<string, string>()
  let mainNum = 0
  let subIndex = 0
  for (const node of nodes) {
    if (node.type !== 'step') continue
    const indent = (node as StepNode).indent ?? 0
    if (indent === 0) {
      mainNum++
      subIndex = 0
      labels.set(node.id, String(mainNum))
    } else {
      subIndex++
      const letter = String.fromCharCode(96 + subIndex) // a, b, c...
      labels.set(node.id, `${mainNum}${letter}`)
    }
  }
  return labels
}

/** Creates a new tip callout node. */
export function createTipNode(variant: TipVariant = 'success', text = ''): TipNode {
  return {
    type: 'tip',
    id: crypto.randomUUID(),
    text,
    variant
  }
}

/** App config (theme, brand colors, storage path) */
export type ThemeMode = 'light' | 'dark' | 'system'

export interface BrandColors {
  primary?: string
  accent?: string
}

export interface AppConfig {
  storagePath?: string
  theme: ThemeMode
  brandColors: BrandColors
  /** ID of the brand logo currently used in editor and PDF. null = no logo. */
  activeBrandLogoId?: string | null
  /** Background color for step cards in editor and PDF. Default #f7f7f7 */
  stepBackgroundColor?: string
  /** Background color for the step number circle in PDF export. Default #ffffff */
  stepNumberIconBgColor?: string
  /** Text color for the step number in PDF export. Default #000000 */
  stepNumberIconTextColor?: string
  /** Display name for the root folder in the Library. Default "My SOPs" */
  rootFolderDisplayName?: string
}

/** Single brand logo entry stored in brand-logos.json */
export interface BrandLogoEntry {
  id: string
  name?: string
  dataUrl: string
}

/** Shape of brand-logos.json file */
export interface BrandLogosData {
  logos: BrandLogoEntry[]
}

/** Tree node for Library sidebar: file (SOP) */
export interface TreeFile {
  type: 'file'
  name: string
  path: string
}

/** Tree node for Library sidebar: folder with children */
export interface TreeFolder {
  type: 'folder'
  name: string
  path: string
  children: TreeItem[]
}

export type TreeItem = TreeFolder | TreeFile

/** Library sidebar sort mode: alpha (A–Z), alpha-desc (Z–A), or custom (user-reordered). */
export type LibrarySortMode = 'alpha' | 'alpha-desc' | 'custom'

export interface LibraryOrder {
  sortMode: LibrarySortMode
  customOrderByFolder: Record<string, string[]>
}
