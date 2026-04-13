import { useRef, useEffect, useState, useCallback } from 'react'
import { Trash2, Circle, ArrowRight, Palette, RectangleHorizontal } from 'lucide-react'
import type { CircleAnnotation, ArrowAnnotation, EllipseAnnotation, BlurAnnotation } from '@shared/types'

interface StepImageWithAnnotationsProps {
  imageUrl: string
  circles: CircleAnnotation[]
  onCirclesChange: (circles: CircleAnnotation[]) => void
  arrows?: ArrowAnnotation[]
  onArrowsChange?: (arrows: ArrowAnnotation[]) => void
  ellipses?: EllipseAnnotation[]
  onEllipsesChange?: (ellipses: EllipseAnnotation[]) => void
  blurs?: BlurAnnotation[]
  onBlursChange?: (blurs: BlurAnnotation[]) => void
  readOnly?: boolean
  className?: string
}

const STROKE_WIDTH = 3
const STROKE_COLOR = 'rgba(59, 130, 246, 0.9)'
const FILL_COLOR = 'rgba(59, 130, 246, 0.15)'

/** Preset colors for circle, arrow, and ellipse annotations (red, green, blue, yellow, purple) */
const ANNOTATION_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7'] as const

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return FILL_COLOR
  const r = parseInt(m[1], 16)
  const g = parseInt(m[2], 16)
  const b = parseInt(m[3], 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function colorToHex(color: string): string {
  if (color.startsWith('#')) return color
  const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!rgba) return '#3b82f6'
  const r = parseInt(rgba[1], 10).toString(16).padStart(2, '0')
  const g = parseInt(rgba[2], 10).toString(16).padStart(2, '0')
  const b = parseInt(rgba[3], 10).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function normalizeHex(hex: string): string {
  const h = hex.replace(/^#/, '').toLowerCase()
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`
}

export function StepImageWithAnnotations({
  imageUrl,
  circles,
  onCirclesChange,
  arrows = [],
  onArrowsChange = () => {},
  ellipses = [],
  onEllipsesChange = () => {},
  blurs = [],
  onBlursChange = () => {},
  readOnly = false,
  className = ''
}: StepImageWithAnnotationsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<'arrow' | 'ellipse' | 'redact'>('ellipse')
  const [drawing, setDrawing] = useState<{ cx: number; cy: number } | null>(null)
  const [drawingArrow, setDrawingArrow] = useState<{ x1: number; y1: number; x2?: number; y2?: number } | null>(null)
  const [drawingEllipse, setDrawingEllipse] = useState<{ x1: number; y1: number; x2?: number; y2?: number } | null>(null)
  const [drawingBlur, setDrawingBlur] = useState<{ x1: number; y1: number; x2?: number; y2?: number } | null>(null)
  const [draggingCircleIndex, setDraggingCircleIndex] = useState<number | null>(null)
  const [draggingArrowIndex, setDraggingArrowIndex] = useState<number | null>(null)
  const [draggingEllipseIndex, setDraggingEllipseIndex] = useState<number | null>(null)
  const [resizingCircleIndex, setResizingCircleIndex] = useState<number | null>(null)
  const [resizingArrowIndex, setResizingArrowIndex] = useState<number | null>(null)
  const [resizingArrowEndpoint, setResizingArrowEndpoint] = useState<'start' | 'end' | null>(null)
  const [hoveredCircleIndex, setHoveredCircleIndex] = useState<number | null>(null)
  const [hoveredArrowIndex, setHoveredArrowIndex] = useState<number | null>(null)
  const [hoveredEllipseIndex, setHoveredEllipseIndex] = useState<number | null>(null)
  const [colorPickerOpenForCircle, setColorPickerOpenForCircle] = useState<number | null>(null)
  const [colorPickerOpenForArrow, setColorPickerOpenForArrow] = useState<number | null>(null)
  const [colorPickerOpenForEllipse, setColorPickerOpenForEllipse] = useState(false)
  const [hoveredResizeHandleIndex, setHoveredResizeHandleIndex] = useState<number | null>(null)
  const [hoveredLeftHandleIndex, setHoveredLeftHandleIndex] = useState<number | null>(null)
  const [hoveredEllipseLeftHandleIndex, setHoveredEllipseLeftHandleIndex] = useState<number | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [canvasOffset, setCanvasOffset] = useState({ left: 0, top: 0 })
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const ellipseDragStartRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null)
  const pendingClearCircleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingClearArrowRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingClearEllipseRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCreatedAnnotationRef = useRef<{ type: 'circle' | 'arrow' | 'ellipse'; index: number } | null>(null)
  const lastCreatedClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const IGNORE_NEW_ANNOTATION_HOVER_MS = 400
  const HOVER_CLEAR_DELAY_MS = 100

  const HANDLE_RADIUS = 12
  const MIN_R_NORM = 0.02

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height)
      const scaleMin = Math.min(width, height)
      circles.forEach((c, i) => {
        const cx = c.cx <= 1 ? c.cx * width : c.cx
        const cy = c.cy <= 1 ? c.cy * height : c.cy
        const r = c.r <= 1 ? c.r * scaleMin : c.r
        const color = c.color || STROKE_COLOR
        const fillColor = color.startsWith('rgba') ? color.replace(/[\d.]+\)$/, '0.15)') : color.startsWith('#') ? hexToRgba(color, 0.15) : FILL_COLOR
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, 2 * Math.PI)
        ctx.fillStyle = fillColor
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = c.strokeWidth ?? STROKE_WIDTH
        ctx.stroke()
        if (!readOnly && hoveredCircleIndex === i) {
          const onLeftHalf = cx < width / 2
          const resizeHandleX = onLeftHalf ? cx - r : cx + r
          const menuHandleX = onLeftHalf ? cx + r : cx - r
          const handleY = cy
          ctx.beginPath()
          ctx.arc(resizeHandleX, handleY, 6, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(menuHandleX, handleY, 6, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      })
      arrows.forEach((a, i) => {
        const x1 = a.x1 <= 1 ? a.x1 * width : a.x1
        const y1 = a.y1 <= 1 ? a.y1 * height : a.y1
        const x2 = a.x2 <= 1 ? a.x2 * width : a.x2
        const y2 = a.y2 <= 1 ? a.y2 * height : a.y2
        const color = a.color || STROKE_COLOR
        const strokeW = a.strokeWidth ?? STROKE_WIDTH
        ctx.strokeStyle = color
        ctx.lineWidth = strokeW
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        const angle = Math.atan2(y2 - y1, x2 - x1)
        const headLen = Math.min(12, Math.hypot(x2 - x1, y2 - y1) * 0.3)
        ctx.beginPath()
        ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4))
        ctx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4))
        ctx.closePath()
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = color
        ctx.stroke()
        if (!readOnly && hoveredArrowIndex === i) {
          const handleRadius = 6
          ctx.beginPath()
          ctx.arc(x1, y1, handleRadius, 0, 2 * Math.PI)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(x2, y2, handleRadius, 0, 2 * Math.PI)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.stroke()
        }
      })
      ellipses.forEach((el, i) => {
        const cx = el.cx <= 1 ? el.cx * width : el.cx
        const cy = el.cy <= 1 ? el.cy * height : el.cy
        const rx = el.rx <= 1 ? el.rx * width : el.rx
        const ry = el.ry <= 1 ? el.ry * height : el.ry
        const color = el.color || STROKE_COLOR
        const fillColor = color.startsWith('rgba') ? color.replace(/[\d.]+\)$/, '0.15)') : color.startsWith('#') ? hexToRgba(color, 0.15) : FILL_COLOR
        ctx.beginPath()
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, 2 * Math.PI)
        ctx.fillStyle = fillColor
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = el.strokeWidth ?? STROKE_WIDTH
        ctx.stroke()
        if (!readOnly && hoveredEllipseIndex === i) {
          const onLeftHalf = cx < width / 2
          const menuHandleX = onLeftHalf ? cx + rx : cx - rx
          const handleY = cy
          ctx.beginPath()
          ctx.arc(menuHandleX, handleY, 6, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      })
      if (drawingArrow && drawingArrow.x2 != null && drawingArrow.y2 != null) {
        const x1 = drawingArrow.x1 <= 1 ? drawingArrow.x1 * width : drawingArrow.x1
        const y1 = drawingArrow.y1 <= 1 ? drawingArrow.y1 * height : drawingArrow.y1
        const x2 = drawingArrow.x2 <= 1 ? drawingArrow.x2 * width : drawingArrow.x2
        const y2 = drawingArrow.y2 <= 1 ? drawingArrow.y2 * height : drawingArrow.y2
        ctx.strokeStyle = STROKE_COLOR
        ctx.lineWidth = STROKE_WIDTH
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
      if (drawingEllipse && drawingEllipse.x2 != null && drawingEllipse.y2 != null) {
        const cx = (drawingEllipse.x1 + drawingEllipse.x2) / 2
        const cy = (drawingEllipse.y1 + drawingEllipse.y2) / 2
        const rx = Math.max(1, Math.abs(drawingEllipse.x2 - drawingEllipse.x1) / 2)
        const ry = Math.max(1, Math.abs(drawingEllipse.y2 - drawingEllipse.y1) / 2)
        ctx.strokeStyle = STROKE_COLOR
        ctx.lineWidth = STROKE_WIDTH
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI)
        ctx.stroke()
      }
      if (drawing) {
        ctx.beginPath()
        ctx.arc(drawing.cx, drawing.cy, 0, 0, 2 * Math.PI)
        ctx.strokeStyle = STROKE_COLOR
        ctx.lineWidth = STROKE_WIDTH
        ctx.stroke()
      }
    },
    [circles, drawing, drawingArrow, drawingEllipse, arrows, ellipses, hoveredCircleIndex, hoveredArrowIndex, hoveredEllipseIndex, readOnly]
  )

  const updateSizeFromImg = useCallback(() => {
    const container = containerRef.current
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!container || !img || !canvas || !imageUrl) return
    const containerRect = container.getBoundingClientRect()
    const imgRect = img.getBoundingClientRect()
    const w = imgRect.width
    const h = imgRect.height
    if (w <= 0 || h <= 0) return
    const left = imgRect.left - containerRect.left
    const top = imgRect.top - containerRect.top
    canvas.width = w
    canvas.height = h
    setSize({ w, h })
    setCanvasOffset({ left, top })
    const ctx = canvas.getContext('2d')
    if (ctx) draw(ctx, w, h)
  }, [imageUrl, draw])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas || !imageUrl) return
    const img = new Image()
    img.src = imageUrl
    img.onload = () => {
      updateSizeFromImg()
    }
  }, [imageUrl, updateSizeFromImg])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      updateSizeFromImg()
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [updateSizeFromImg])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const ctx = canvas.getContext('2d')
    if (ctx) draw(ctx, size.w, size.h)
  }, [draw, size])

  const scale = size.w && size.h ? Math.min(size.w, size.h) : 1

  const getCoords = (e: React.MouseEvent): { x: number; y: number; nx: number; ny: number } | null => {
    const img = imgRef.current
    if (!img || size.w === 0 || size.h === 0) return null
    const rect = img.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = ((e.clientX - rect.left) / rect.width) * size.w
    const y = ((e.clientY - rect.top) / rect.height) * size.h
    return { x, y, nx: x / size.w, ny: y / size.h }
  }

  const circleToPixel = (c: CircleAnnotation) => {
    const cx = c.cx <= 1 ? c.cx * size.w : c.cx
    const cy = c.cy <= 1 ? c.cy * size.h : c.cy
    const r = c.r <= 1 ? c.r * scale : c.r
    return { cx, cy, r }
  }

  const arrowToPixel = (a: ArrowAnnotation) => {
    const x1 = a.x1 <= 1 ? a.x1 * size.w : a.x1
    const y1 = a.y1 <= 1 ? a.y1 * size.h : a.y1
    const x2 = a.x2 <= 1 ? a.x2 * size.w : a.x2
    const y2 = a.y2 <= 1 ? a.y2 * size.h : a.y2
    return { x1, y1, x2, y2 }
  }

  function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len === 0) return Math.hypot(px - x1, py - y1)
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)))
    const projX = x1 + t * dx
    const projY = y1 + t * dy
    return Math.hypot(px - projX, py - projY)
  }

  const hitTestArrow = (x: number, y: number): number | null => {
    const threshold = 8
    for (let i = arrows.length - 1; i >= 0; i--) {
      const { x1, y1, x2, y2 } = arrowToPixel(arrows[i])
      if (distanceToSegment(x, y, x1, y1, x2, y2) <= threshold) return i
    }
    return null
  }

  const hitTestArrowEndpoint = (
    x: number,
    y: number
  ): { index: number; endpoint: 'start' | 'end' } | null => {
    const threshold = 10
    for (let i = arrows.length - 1; i >= 0; i--) {
      const { x1, y1, x2, y2 } = arrowToPixel(arrows[i])
      if (Math.hypot(x - x2, y - y2) <= threshold) return { index: i, endpoint: 'end' }
      if (Math.hypot(x - x1, y - y1) <= threshold) return { index: i, endpoint: 'start' }
    }
    return null
  }

  const ellipseToPixel = (el: EllipseAnnotation) => {
    const cx = el.cx <= 1 ? el.cx * size.w : el.cx
    const cy = el.cy <= 1 ? el.cy * size.h : el.cy
    const rx = el.rx <= 1 ? el.rx * size.w : el.rx
    const ry = el.ry <= 1 ? el.ry * size.h : el.ry
    return { cx, cy, rx, ry }
  }

  const hitTestEllipse = (x: number, y: number): number | null => {
    for (let i = ellipses.length - 1; i >= 0; i--) {
      const { cx, cy, rx, ry } = ellipseToPixel(ellipses[i])
      if (rx <= 0 || ry <= 0) continue
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) return i
    }
    return null
  }

  const hitTestCircle = (x: number, y: number): number | null => {
    for (let i = circles.length - 1; i >= 0; i--) {
      const { cx, cy, r } = circleToPixel(circles[i])
      if (Math.hypot(x - cx, y - cy) <= r) return i
    }
    return null
  }

  const isOverResizeHandle = (x: number, y: number, circleIndex: number): boolean => {
    const { cx, cy, r } = circleToPixel(circles[circleIndex])
    const onLeftHalf = cx < size.w / 2
    const handleX = onLeftHalf ? cx - r : cx + r
    return Math.hypot(x - handleX, y - cy) <= HANDLE_RADIUS
  }

  const isOverMenuHandle = (x: number, y: number, circleIndex: number): boolean => {
    const { cx, cy, r } = circleToPixel(circles[circleIndex])
    const onLeftHalf = cx < size.w / 2
    const handleX = onLeftHalf ? cx + r : cx - r
    return Math.hypot(x - handleX, y - cy) <= HANDLE_RADIUS
  }

  const isOverEllipseMenuHandle = (x: number, y: number, ellipseIndex: number): boolean => {
    const { cx, cy, rx } = ellipseToPixel(ellipses[ellipseIndex])
    const onLeftHalf = cx < size.w / 2
    const handleX = onLeftHalf ? cx + rx : cx - rx
    return Math.hypot(x - handleX, y - cy) <= HANDLE_RADIUS
  }

  const handlePointerDown = (e: React.MouseEvent) => {
    if (readOnly) return
    const coords = getCoords(e)
    if (!coords) return
    lastPointerRef.current = { x: coords.x, y: coords.y }
    const arrowEndpointHit = hitTestArrowEndpoint(coords.x, coords.y)
    const arrowHit = arrowEndpointHit ? null : hitTestArrow(coords.x, coords.y)
    const ellipseHit = hitTestEllipse(coords.x, coords.y)
    const circleHit = hitTestCircle(coords.x, coords.y)
    if (arrowEndpointHit) {
      setResizingArrowIndex(arrowEndpointHit.index)
      setResizingArrowEndpoint(arrowEndpointHit.endpoint)
    } else if (arrowHit !== null) {
      setDraggingArrowIndex(arrowHit)
    } else if (ellipseHit !== null) {
      if (isOverEllipseMenuHandle(coords.x, coords.y, ellipseHit)) {
        // Don't start drag; user can interact with the panel at the left dot
      } else {
        const el = ellipses[ellipseHit]
        ellipseDragStartRef.current = {
          px: coords.x,
          py: coords.y,
          cx: el.cx <= 1 ? el.cx : el.cx / size.w,
          cy: el.cy <= 1 ? el.cy : el.cy / size.h,
        }
        setDraggingEllipseIndex(ellipseHit)
      }
    } else if (circleHit !== null) {
      if (isOverResizeHandle(coords.x, coords.y, circleHit)) {
        setResizingCircleIndex(circleHit)
      } else if (isOverMenuHandle(coords.x, coords.y, circleHit)) {
        // Don't start drag; user can interact with the panel at the left dot
      } else {
        setDraggingCircleIndex(circleHit)
      }
    } else if (tool === 'arrow') {
      setDrawingArrow({ x1: coords.x, y1: coords.y })
    } else if (tool === 'ellipse') {
      setDrawingEllipse({ x1: coords.x, y1: coords.y })
    } else if (tool === 'redact') {
      setDrawingBlur({ x1: coords.x, y1: coords.y })
    } else {
      setDrawing({ cx: coords.x, cy: coords.y })
    }
  }

  const handlePointerMove = (e: React.MouseEvent) => {
    const coords = getCoords(e)
    if (!coords) return

    if (draggingCircleIndex === null && !drawing && resizingCircleIndex === null && resizingArrowIndex === null && draggingArrowIndex === null && draggingEllipseIndex === null && !drawingArrow && !drawingEllipse) {
      const isOverAnnotationMenu = e.target instanceof Element && (e.target as Element).closest('[data-annotation-menu]')
      if (!isOverAnnotationMenu) {
        const arrowHit = hitTestArrow(coords.x, coords.y)
        const ellipseHit = hitTestEllipse(coords.x, coords.y)
        const circleHit = hitTestCircle(coords.x, coords.y)
        if (arrowHit !== null) {
          const ignore = lastCreatedAnnotationRef.current?.type === 'arrow' && lastCreatedAnnotationRef.current.index === arrowHit
          if (!ignore) {
            if (pendingClearArrowRef.current) {
              clearTimeout(pendingClearArrowRef.current)
              pendingClearArrowRef.current = null
            }
            setHoveredArrowIndex(arrowHit)
            setHoveredCircleIndex(null)
            setHoveredEllipseIndex(null)
            setHoveredResizeHandleIndex(null)
          }
          } else if (ellipseHit !== null) {
          const ignore = lastCreatedAnnotationRef.current?.type === 'ellipse' && lastCreatedAnnotationRef.current.index === ellipseHit
          if (!ignore) {
            if (pendingClearEllipseRef.current) {
              clearTimeout(pendingClearEllipseRef.current)
              pendingClearEllipseRef.current = null
            }
            setHoveredEllipseIndex(ellipseHit)
            setHoveredEllipseLeftHandleIndex(isOverEllipseMenuHandle(coords.x, coords.y, ellipseHit) ? ellipseHit : null)
            setHoveredCircleIndex(null)
            setHoveredArrowIndex(null)
            setHoveredResizeHandleIndex(null)
          }
          } else if (circleHit !== null) {
          const ignore = lastCreatedAnnotationRef.current?.type === 'circle' && lastCreatedAnnotationRef.current.index === circleHit
          if (!ignore) {
            if (pendingClearCircleRef.current) {
              clearTimeout(pendingClearCircleRef.current)
              pendingClearCircleRef.current = null
            }
            setHoveredCircleIndex(circleHit)
            setHoveredResizeHandleIndex(isOverResizeHandle(coords.x, coords.y, circleHit) ? circleHit : null)
            setHoveredLeftHandleIndex(isOverMenuHandle(coords.x, coords.y, circleHit) ? circleHit : null)
            setHoveredArrowIndex(null)
            setHoveredEllipseIndex(null)
          }
          } else if (hoveredCircleIndex !== null) {
          const { cx, cy, r } = circleToPixel(circles[hoveredCircleIndex])
          const trashSize = 30
          const inTrashZone =
            coords.x >= cx + r - trashSize &&
            coords.x <= cx + r + 4 &&
            coords.y >= cy + r - trashSize &&
            coords.y <= cy + r + 4
          if (!inTrashZone && !isOverAnnotationMenu) {
            if (pendingClearCircleRef.current) clearTimeout(pendingClearCircleRef.current)
            pendingClearCircleRef.current = setTimeout(() => {
              setHoveredCircleIndex(null)
              setColorPickerOpenForCircle(null)
              pendingClearCircleRef.current = null
            }, HOVER_CLEAR_DELAY_MS)
            setHoveredResizeHandleIndex(null)
            setHoveredLeftHandleIndex(null)
          }
          } else if (hoveredArrowIndex !== null) {
          if (!isOverAnnotationMenu) {
            if (pendingClearArrowRef.current) clearTimeout(pendingClearArrowRef.current)
            pendingClearArrowRef.current = setTimeout(() => {
              setHoveredArrowIndex(null)
              setColorPickerOpenForArrow(null)
              pendingClearArrowRef.current = null
            }, HOVER_CLEAR_DELAY_MS)
          }
          } else if (hoveredEllipseIndex !== null) {
          if (!isOverAnnotationMenu) {
            if (pendingClearEllipseRef.current) clearTimeout(pendingClearEllipseRef.current)
            pendingClearEllipseRef.current = setTimeout(() => {
              setHoveredEllipseIndex(null)
              setColorPickerOpenForEllipse(false)
              setHoveredEllipseLeftHandleIndex(null)
              pendingClearEllipseRef.current = null
            }, HOVER_CLEAR_DELAY_MS)
          }
        } else {
          if (!isOverAnnotationMenu) {
            if (pendingClearCircleRef.current) {
              clearTimeout(pendingClearCircleRef.current)
              pendingClearCircleRef.current = null
            }
            if (pendingClearArrowRef.current) {
              clearTimeout(pendingClearArrowRef.current)
              pendingClearArrowRef.current = null
            }
            if (pendingClearEllipseRef.current) {
              clearTimeout(pendingClearEllipseRef.current)
              pendingClearEllipseRef.current = null
            }
            setHoveredCircleIndex(null)
            setHoveredResizeHandleIndex(null)
            setHoveredArrowIndex(null)
            setHoveredEllipseIndex(null)
            setHoveredLeftHandleIndex(null)
            setHoveredEllipseLeftHandleIndex(null)
          }
        }
      }
    }

    if (drawingEllipse) {
      setDrawingEllipse((prev) => (prev ? { ...prev, x2: coords.x, y2: coords.y } : null))
      return
    }

    if (drawingBlur) {
      setDrawingBlur((prev) => (prev ? { ...prev, x2: coords.x, y2: coords.y } : null))
      return
    }

    if (draggingEllipseIndex !== null) {
      const next = [...ellipses]
      const el = next[draggingEllipseIndex]
      const start = ellipseDragStartRef.current
      if (el && start && size.w > 0 && size.h > 0) {
        const dx = (coords.x - start.px) / size.w
        const dy = (coords.y - start.py) / size.h
        next[draggingEllipseIndex] = { ...el, cx: start.cx + dx, cy: start.cy + dy }
        onEllipsesChange(next)
      }
      return
    }

    if (drawingArrow) {
      setDrawingArrow((prev) => (prev ? { ...prev, x2: coords.x, y2: coords.y } : null))
      return
    }

    if (resizingArrowIndex !== null && resizingArrowEndpoint) {
      const next = [...arrows]
      const a = next[resizingArrowIndex]
      if (a) {
        const keyX = resizingArrowEndpoint === 'start' ? 'x1' : 'x2'
        const keyY = resizingArrowEndpoint === 'start' ? 'y1' : 'y2'
        next[resizingArrowIndex] = {
          ...a,
          [keyX]: coords.nx,
          [keyY]: coords.ny
        }
        onArrowsChange(next)
      }
      return
    }

    if (draggingArrowIndex !== null) {
      const next = [...arrows]
      const a = next[draggingArrowIndex]
      if (a) {
        const last = lastPointerRef.current
        lastPointerRef.current = { x: coords.x, y: coords.y }
        if (last && size.w > 0 && size.h > 0) {
          const dx = (coords.x - last.x) / size.w
          const dy = (coords.y - last.y) / size.h
          next[draggingArrowIndex] = {
            ...a,
            x1: (a.x1 <= 1 ? a.x1 : a.x1 / size.w) + dx,
            y1: (a.y1 <= 1 ? a.y1 : a.y1 / size.h) + dy,
            x2: (a.x2 <= 1 ? a.x2 : a.x2 / size.w) + dx,
            y2: (a.y2 <= 1 ? a.y2 : a.y2 / size.h) + dy
          }
          onArrowsChange(next)
        }
      }
      return
    }

    if (resizingCircleIndex !== null) {
      const next = [...circles]
      const c = next[resizingCircleIndex]
      if (c) {
        const cxPix = c.cx <= 1 ? c.cx * size.w : c.cx
        const cyPix = c.cy <= 1 ? c.cy * size.h : c.cy
        const newRpix = Math.hypot(coords.x - cxPix, coords.y - cyPix)
        const rNorm = Math.max(MIN_R_NORM, newRpix / scale)
        next[resizingCircleIndex] = { ...c, r: rNorm }
        onCirclesChange(next)
      }
      return
    }

    if (draggingCircleIndex !== null) {
      const next = [...circles]
      const c = next[draggingCircleIndex]
      if (c) {
        next[draggingCircleIndex] = {
          ...c,
          cx: coords.nx,
          cy: coords.ny
        }
        onCirclesChange(next)
      }
      return
    }

    if (!drawing) return
    setHoveredCircleIndex(null)
    const r = Math.hypot(coords.x - drawing.cx, coords.y - drawing.cy)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    circles.forEach((c) => {
      const { cx, cy, r: cr } = circleToPixel(c)
      const color = c.color || STROKE_COLOR
      const fillColor = color.startsWith('rgba') ? color.replace(/[\d.]+\)$/, '0.15)') : color.startsWith('#') ? hexToRgba(color, 0.15) : FILL_COLOR
      ctx.beginPath()
      ctx.arc(cx, cy, cr, 0, 2 * Math.PI)
      ctx.fillStyle = fillColor
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = c.strokeWidth ?? STROKE_WIDTH
      ctx.stroke()
    })
    ctx.beginPath()
    ctx.arc(drawing.cx, drawing.cy, r, 0, 2 * Math.PI)
    ctx.strokeStyle = STROKE_COLOR
    ctx.lineWidth = STROKE_WIDTH
    ctx.stroke()
  }

  const handlePointerUp = (e: React.MouseEvent) => {
    if (drawingEllipse) {
      const coords = getCoords(e)
      if (coords && drawingEllipse.x2 != null && drawingEllipse.y2 != null) {
        const cx = (drawingEllipse.x1 + drawingEllipse.x2) / 2
        const cy = (drawingEllipse.y1 + drawingEllipse.y2) / 2
        const rx = Math.abs(drawingEllipse.x2 - drawingEllipse.x1) / 2
        const ry = Math.abs(drawingEllipse.y2 - drawingEllipse.y1) / 2
        const scaleMin = Math.min(size.w, size.h)
        if (scaleMin > 0 && rx / size.w >= 0.01 && ry / size.h >= 0.01) {
          const newIndex = ellipses.length
          onEllipsesChange([
            ...ellipses,
            {
              cx: cx / size.w,
              cy: cy / size.h,
              rx: rx / size.w,
              ry: ry / size.h,
              strokeWidth: STROKE_WIDTH,
              color: STROKE_COLOR
            }
          ])
          if (lastCreatedClearRef.current) clearTimeout(lastCreatedClearRef.current)
          lastCreatedAnnotationRef.current = { type: 'ellipse', index: newIndex }
          lastCreatedClearRef.current = setTimeout(() => {
            lastCreatedAnnotationRef.current = null
            lastCreatedClearRef.current = null
          }, IGNORE_NEW_ANNOTATION_HOVER_MS)
          setHoveredEllipseIndex(null)
          setHoveredEllipseLeftHandleIndex(null)
        }
      }
      setDrawingEllipse(null)
      return
    }
    if (drawingBlur) {
      const coords = getCoords(e)
      if (coords && drawingBlur.x2 != null && drawingBlur.y2 != null) {
        const x = Math.min(drawingBlur.x1, drawingBlur.x2)
        const y = Math.min(drawingBlur.y1, drawingBlur.y2)
        const w = Math.abs(drawingBlur.x2 - drawingBlur.x1)
        const h = Math.abs(drawingBlur.y2 - drawingBlur.y1)
        if (w / size.w >= 0.01 && h / size.h >= 0.01) {
          onBlursChange([
            ...blurs,
            {
              x: x / size.w,
              y: y / size.h,
              w: w / size.w,
              h: h / size.h,
              mode: 'redact',
              color: '#000000'
            }
          ])
        }
      }
      setDrawingBlur(null)
      return
    }
    if (drawingArrow) {
      const coords = getCoords(e)
      if (coords && drawingArrow.x2 != null && drawingArrow.y2 != null) {
        const len = Math.hypot(drawingArrow.x2 - drawingArrow.x1, drawingArrow.y2 - drawingArrow.y1)
        const scaleMin = Math.min(size.w, size.h)
        if (scaleMin > 0 && len / scaleMin >= 0.02) {
          const newIndex = arrows.length
          onArrowsChange([
            ...arrows,
            {
              x1: drawingArrow.x1 / size.w,
              y1: drawingArrow.y1 / size.h,
              x2: drawingArrow.x2 / size.w,
              y2: drawingArrow.y2 / size.h,
              strokeWidth: STROKE_WIDTH,
              color: STROKE_COLOR
            }
          ])
          if (lastCreatedClearRef.current) clearTimeout(lastCreatedClearRef.current)
          lastCreatedAnnotationRef.current = { type: 'arrow', index: newIndex }
          lastCreatedClearRef.current = setTimeout(() => {
            lastCreatedAnnotationRef.current = null
            lastCreatedClearRef.current = null
          }, IGNORE_NEW_ANNOTATION_HOVER_MS)
          setHoveredArrowIndex(null)
        }
      }
      setDrawingArrow(null)
      return
    }
    if (draggingArrowIndex !== null) {
      lastPointerRef.current = null
      setDraggingArrowIndex(null)
      return
    }
    if (resizingArrowIndex !== null) {
      lastPointerRef.current = null
      setResizingArrowIndex(null)
      setResizingArrowEndpoint(null)
      return
    }
    if (draggingEllipseIndex !== null) {
      lastPointerRef.current = null
      ellipseDragStartRef.current = null
      setDraggingEllipseIndex(null)
      return
    }
    if (resizingCircleIndex !== null) {
      setResizingCircleIndex(null)
      return
    }
    if (draggingCircleIndex !== null) {
      setDraggingCircleIndex(null)
      return
    }
    if (!drawing) return
    const coords = getCoords(e)
    if (coords) {
      const r = Math.hypot(coords.x - drawing.cx, coords.y - drawing.cy)
      const rNorm = r / scale
      if (rNorm >= 0.02) {
        const newIndex = circles.length
        onCirclesChange([
          ...circles,
          {
            cx: drawing.cx / size.w,
            cy: drawing.cy / size.h,
            r: rNorm,
            strokeWidth: STROKE_WIDTH,
            color: STROKE_COLOR
          }
        ])
        if (lastCreatedClearRef.current) clearTimeout(lastCreatedClearRef.current)
        lastCreatedAnnotationRef.current = { type: 'circle', index: newIndex }
        lastCreatedClearRef.current = setTimeout(() => {
          lastCreatedAnnotationRef.current = null
          lastCreatedClearRef.current = null
        }, IGNORE_NEW_ANNOTATION_HOVER_MS)
        setHoveredCircleIndex(null)
        setHoveredResizeHandleIndex(null)
        setHoveredLeftHandleIndex(null)
      }
    }
    setDrawing(null)
  }

  return (
    <div
      ref={containerRef}
      className={`relative inline-block max-w-full ${className}`}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={() => {
        if (lastCreatedClearRef.current) {
          clearTimeout(lastCreatedClearRef.current)
          lastCreatedClearRef.current = null
        }
        lastCreatedAnnotationRef.current = null
        setDrawing(null)
        setDrawingArrow(null)
        setDrawingEllipse(null)
        setDraggingCircleIndex(null)
        setDraggingArrowIndex(null)
        setDraggingEllipseIndex(null)
        setResizingCircleIndex(null)
        setResizingArrowIndex(null)
        setResizingArrowEndpoint(null)
        setHoveredCircleIndex(null)
        setHoveredArrowIndex(null)
        setHoveredEllipseIndex(null)
        setColorPickerOpenForCircle(null)
        setColorPickerOpenForArrow(null)
        setColorPickerOpenForEllipse(false)
        setHoveredResizeHandleIndex(null)
        setHoveredLeftHandleIndex(null)
        setHoveredEllipseLeftHandleIndex(null)
        if (pendingClearCircleRef.current) {
          clearTimeout(pendingClearCircleRef.current)
          pendingClearCircleRef.current = null
        }
        if (pendingClearArrowRef.current) {
          clearTimeout(pendingClearArrowRef.current)
          pendingClearArrowRef.current = null
        }
        if (pendingClearEllipseRef.current) {
          clearTimeout(pendingClearEllipseRef.current)
          pendingClearEllipseRef.current = null
        }
        lastPointerRef.current = null
      }}
      style={{ maxHeight: 256 }}
    >
      {!readOnly && (
        <div className="absolute top-1 left-1 z-20 flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 shadow">
          <button
            type="button"
            title="Arrow tool"
            aria-label="Arrow tool"
            className={`rounded px-1.5 py-1 text-xs font-medium ${tool === 'arrow' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            onClick={() => setTool('arrow')}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Ellipse tool"
            aria-label="Ellipse tool"
            className={`rounded px-1.5 py-1 text-xs font-medium ${tool === 'ellipse' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            onClick={() => setTool('ellipse')}
          >
            <Circle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Redact tool"
            aria-label="Redact tool"
            className={`rounded px-1.5 py-1 text-xs font-medium ${tool === 'redact' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            onClick={() => setTool('redact')}
          >
            <RectangleHorizontal className="h-3.5 w-3.5" fill="currentColor" />
          </button>
        </div>
      )}
      <img
        ref={imgRef}
        src={imageUrl}
        alt=""
        className="max-h-64 max-w-full object-contain block w-full"
        onLoad={updateSizeFromImg}
      />
      <canvas
        ref={canvasRef}
        className="absolute"
        style={{
          left: canvasOffset.left,
          top: canvasOffset.top,
          width: size.w,
          height: size.h,
          pointerEvents: readOnly ? 'none' : 'auto',
          cursor: readOnly
            ? 'default'
            : resizingCircleIndex !== null
              ? 'nwse-resize'
              : resizingArrowIndex !== null
              ? 'nwse-resize'
              : draggingCircleIndex !== null
                ? 'grabbing'
                : draggingArrowIndex !== null
                  ? 'grabbing'
                  : draggingEllipseIndex !== null
                    ? 'grabbing'
                    : drawingArrow
                      ? 'crosshair'
                      : drawingEllipse
                        ? 'crosshair'
                        : hoveredResizeHandleIndex !== null
                          ? 'nwse-resize'
                          : hoveredLeftHandleIndex !== null
                              ? 'pointer'
                              : hoveredEllipseLeftHandleIndex !== null
                                ? 'pointer'
                                : hoveredCircleIndex !== null
                            ? 'grab'
                            : hoveredArrowIndex !== null
                              ? 'grab'
                              : hoveredEllipseIndex !== null
                                ? 'grab'
                                : 'crosshair'
        }}
      />
      {!readOnly && hoveredCircleIndex !== null && size.w > 0 && size.h > 0 && (() => {
        const { cx, cy, r } = circleToPixel(circles[hoveredCircleIndex])
        const circle = circles[hoveredCircleIndex]
        const showColorSwatches = colorPickerOpenForCircle === hoveredCircleIndex
        const onLeftHalf = cx < size.w / 2
        return (
          <div
            className="absolute z-20"
            data-annotation-menu
            style={{
              left: canvasOffset.left + (onLeftHalf ? cx + r : cx - r),
              top: canvasOffset.top + cy,
              transform: onLeftHalf ? 'translate(0%, -50%)' : 'translate(-100%, -50%)',
              pointerEvents: 'auto'
            }}
            onMouseEnter={() => {
              if (pendingClearCircleRef.current) {
                clearTimeout(pendingClearCircleRef.current)
                pendingClearCircleRef.current = null
              }
            }}
          >
            <div
              className="flex items-center gap-1.5 rounded-md bg-background/95 p-1.5 shadow-md border"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseLeave={() => {
                setHoveredCircleIndex(null)
                setColorPickerOpenForCircle(null)
              }}
              style={{ pointerEvents: 'auto' }}
            >
              <button
                type="button"
                className="rounded px-2 py-1.5 text-xs font-medium hover:bg-muted flex items-center justify-center"
                onMouseEnter={() => setColorPickerOpenForCircle(hoveredCircleIndex)}
                onClick={(e) => {
                  e.stopPropagation()
                  setColorPickerOpenForCircle(showColorSwatches ? null : hoveredCircleIndex)
                }}
                title="Change color"
                aria-label="Change circle color"
              >
                <Palette className="h-3.5 w-3.5" />
              </button>
              {showColorSwatches && (
                <div className="flex items-center gap-1">
                  {ANNOTATION_COLORS.map((hex) => {
                    const colorHex = colorToHex(circle.color || STROKE_COLOR)
                    const isActive = normalizeHex(colorHex) === normalizeHex(hex)
                    return (
                      <button
                        key={hex}
                        type="button"
                        className={`w-7 h-7 rounded border shrink-0 ${isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'border-border hover:opacity-90'}`}
                        style={{ backgroundColor: hex }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const next = [...circles]
                          next[hoveredCircleIndex] = { ...circle, color: hex }
                          onCirclesChange(next)
                          setColorPickerOpenForCircle(null)
                        }}
                        aria-label={`Set color ${hex}`}
                      />
                    )
                  })}
                </div>
              )}
              <button
                type="button"
                className="rounded-md bg-destructive/90 hover:bg-destructive text-destructive-foreground p-1.5 shadow-md border-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onCirclesChange(circles.filter((_, i) => i !== hoveredCircleIndex))
                  setHoveredCircleIndex(null)
                  setColorPickerOpenForCircle(null)
                }}
                aria-label="Delete circle"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })()}
      {!readOnly && hoveredArrowIndex !== null && arrows[hoveredArrowIndex] && size.w > 0 && size.h > 0 && (() => {
        const arrow = arrows[hoveredArrowIndex]
        const { x1, y1, x2, y2 } = arrowToPixel(arrow)
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        const showColorSwatches = colorPickerOpenForArrow === hoveredArrowIndex
        return (
          <div
            className="absolute z-20"
            data-annotation-menu
            style={{
              left: canvasOffset.left + midX,
              top: canvasOffset.top + midY - 24,
              transform: 'translateX(-50%)',
              pointerEvents: 'auto'
            }}
            onMouseEnter={() => {
              if (pendingClearArrowRef.current) {
                clearTimeout(pendingClearArrowRef.current)
                pendingClearArrowRef.current = null
              }
            }}
          >
            <div
              className="flex items-center gap-1.5 rounded-md bg-background/95 p-1.5 shadow-md border"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseLeave={() => {
                setHoveredArrowIndex(null)
                setColorPickerOpenForArrow(null)
              }}
              style={{ pointerEvents: 'auto' }}
            >
              <button
                type="button"
                className="rounded px-2 py-1.5 text-xs font-medium hover:bg-muted flex items-center justify-center"
                onMouseEnter={() => setColorPickerOpenForArrow(hoveredArrowIndex)}
                onClick={(e) => {
                  e.stopPropagation()
                  setColorPickerOpenForArrow(showColorSwatches ? null : hoveredArrowIndex)
                }}
                title="Change color"
                aria-label="Change arrow color"
              >
                <Palette className="h-3.5 w-3.5" />
              </button>
              {showColorSwatches && (
                <div className="flex items-center gap-1">
                  {ANNOTATION_COLORS.map((hex) => {
                    const colorHex = colorToHex(arrow.color || STROKE_COLOR)
                    const isActive = normalizeHex(colorHex) === normalizeHex(hex)
                    return (
                      <button
                        key={hex}
                        type="button"
                        className={`w-7 h-7 rounded border shrink-0 ${isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'border-border hover:opacity-90'}`}
                        style={{ backgroundColor: hex }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const next = [...arrows]
                          next[hoveredArrowIndex] = { ...arrow, color: hex }
                          onArrowsChange(next)
                          setColorPickerOpenForArrow(null)
                        }}
                        aria-label={`Set color ${hex}`}
                      />
                    )
                  })}
                </div>
              )}
              <button
                type="button"
                className="rounded-md bg-destructive/90 hover:bg-destructive text-destructive-foreground p-1.5 shadow-md border-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onArrowsChange(arrows.filter((_, i) => i !== hoveredArrowIndex))
                  setHoveredArrowIndex(null)
                  setColorPickerOpenForArrow(null)
                }}
                aria-label="Delete arrow"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })()}
      {!readOnly && hoveredEllipseIndex !== null && ellipses[hoveredEllipseIndex] && size.w > 0 && size.h > 0 && (() => {
        const { cx, cy, rx } = ellipseToPixel(ellipses[hoveredEllipseIndex])
        const ellipse = ellipses[hoveredEllipseIndex]
        const showColorSwatches = colorPickerOpenForEllipse
        const onLeftHalf = cx < size.w / 2
        return (
          <div
            className="absolute z-20"
            data-annotation-menu
            style={{
              left: canvasOffset.left + (onLeftHalf ? cx + rx : cx - rx),
              top: canvasOffset.top + cy,
              transform: onLeftHalf ? 'translate(0%, -50%)' : 'translate(-100%, -50%)',
              pointerEvents: 'auto'
            }}
            onMouseEnter={() => {
              if (pendingClearEllipseRef.current) {
                clearTimeout(pendingClearEllipseRef.current)
                pendingClearEllipseRef.current = null
              }
            }}
          >
            <div
              className="flex items-center gap-1.5 rounded-md bg-background/95 p-1.5 shadow-md border"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseLeave={() => {
                setHoveredEllipseIndex(null)
                setColorPickerOpenForEllipse(false)
              }}
              style={{ pointerEvents: 'auto' }}
            >
              <button
                type="button"
                className="rounded px-2 py-1.5 text-xs font-medium hover:bg-muted flex items-center justify-center"
                onMouseEnter={() => setColorPickerOpenForEllipse(true)}
                onClick={(e) => {
                  e.stopPropagation()
                  setColorPickerOpenForEllipse(!showColorSwatches)
                }}
                title="Change color"
                aria-label="Change ellipse color"
              >
                <Palette className="h-3.5 w-3.5" />
              </button>
              {showColorSwatches && (
                <div className="flex items-center gap-1">
                  {ANNOTATION_COLORS.map((hex) => {
                    const colorHex = colorToHex(ellipse.color || STROKE_COLOR)
                    const isActive = normalizeHex(colorHex) === normalizeHex(hex)
                    return (
                      <button
                        key={hex}
                        type="button"
                        className={`w-7 h-7 rounded border shrink-0 ${isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'border-border hover:opacity-90'}`}
                        style={{ backgroundColor: hex }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const next = [...ellipses]
                          next[hoveredEllipseIndex] = { ...ellipse, color: hex }
                          onEllipsesChange(next)
                          setColorPickerOpenForEllipse(false)
                        }}
                        aria-label={`Set color ${hex}`}
                      />
                    )
                  })}
                </div>
              )}
              <button
                type="button"
                className="rounded-md bg-destructive/90 hover:bg-destructive text-destructive-foreground p-1.5 shadow-md border-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onEllipsesChange(ellipses.filter((_, i) => i !== hoveredEllipseIndex))
                  setHoveredEllipseIndex(null)
                  setColorPickerOpenForEllipse(false)
                }}
                aria-label="Delete ellipse"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })()}
      {/* Redact overlays */}
      {blurs.map((b, i) => {
        const bx = b.x * size.w
        const by = b.y * size.h
        const bw = b.w * size.w
        const bh = b.h * size.h
        return (
          <div
            key={`blur-${i}`}
            className={`absolute ${readOnly ? 'pointer-events-none' : 'group cursor-pointer'}`}
            style={{
              left: bx,
              top: by,
              width: bw,
              height: bh,
              backgroundColor: b.color || '#000',
            }}
            onMouseDown={(e) => {
              if (readOnly) return
              e.stopPropagation()
            }}
          >
            {!readOnly && (
              <button
                type="button"
                className="absolute top-1 right-1 hidden group-hover:flex items-center justify-center rounded-md bg-destructive/90 hover:bg-destructive text-destructive-foreground p-1 shadow-md border-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onBlursChange(blurs.filter((_, j) => j !== i))
                }}
                aria-label="Delete redaction"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
      })}
      {/* Drawing blur preview */}
      {drawingBlur && drawingBlur.x2 != null && drawingBlur.y2 != null && (
        <div
          className="absolute pointer-events-none border-2 border-dashed border-red-500"
          style={{
            left: Math.min(drawingBlur.x1, drawingBlur.x2),
            top: Math.min(drawingBlur.y1, drawingBlur.y2),
            width: Math.abs(drawingBlur.x2 - drawingBlur.x1),
            height: Math.abs(drawingBlur.y2 - drawingBlur.y1),
            backgroundColor: 'rgba(0,0,0,0.5)',
          }}
        />
      )}
    </div>
  )
}
