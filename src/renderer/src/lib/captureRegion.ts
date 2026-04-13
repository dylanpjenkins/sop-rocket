/**
 * Capture a region of the screen around (screenX, screenY) and return as a data URL.
 * Used by auto-capture mode to add a step per global click.
 * Keeps a per-display stream cache so grabFrame() is fast (no getUserMedia on each click).
 */

const CROP_WIDTH = 640
const CROP_HEIGHT = 336
const MAX_STREAM_CACHE = 4

export interface CapturePayload {
  screenX: number
  screenY: number
  displayId?: number
  displayBounds?: { x: number; y: number; width: number; height: number }
}

export interface DesktopSource {
  id: string
  name: string
  display_id: string
}

interface CachedEntry {
  stream: MediaStream
  imageCapture: InstanceType<typeof ImageCapture>
}

// LRU cache: sourceId -> { stream, imageCapture }. Map iteration order = insertion order.
const streamCache = new Map<string, CachedEntry>()

function evictOne(): void {
  const firstKey = streamCache.keys().next().value
  if (firstKey == null) return
  const entry = streamCache.get(firstKey)
  streamCache.delete(firstKey)
  if (entry) {
    entry.stream.getTracks().forEach((t) => t.stop())
  }
}

/**
 * Release all cached streams (call when recording stops).
 */
export function releaseStreamCache(): void {
  streamCache.forEach((entry) => {
    entry.stream.getTracks().forEach((t) => t.stop())
  })
  streamCache.clear()
}

async function getStreamForSource(sourceId: string): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId
      }
    } as MediaTrackConstraints
  })
  return stream
}

function getCachedEntry(sourceId: string): CachedEntry | null {
  const entry = streamCache.get(sourceId)
  if (!entry) return null
  // Move to end for LRU (Map iteration order)
  streamCache.delete(sourceId)
  streamCache.set(sourceId, entry)
  return entry
}

async function getOrCreateEntry(
  sourceId: string,
  ImageCaptureCtor: new (t: MediaStreamTrack) => InstanceType<typeof ImageCapture>
): Promise<CachedEntry> {
  const cached = getCachedEntry(sourceId)
  if (cached) return cached
  while (streamCache.size >= MAX_STREAM_CACHE) {
    evictOne()
  }
  const stream = await getStreamForSource(sourceId)
  const track = stream.getVideoTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('No video track')
  }
  const imageCapture = new ImageCaptureCtor(track)
  const entry: CachedEntry = { stream, imageCapture }
  streamCache.set(sourceId, entry)
  return entry
}

function cropBitmapToResult(
  bitmap: ImageBitmap,
  screenX: number,
  screenY: number,
  displayBounds: CapturePayload['displayBounds']
): CaptureResult | null {
  const fullW = bitmap.width
  const fullH = bitmap.height
  if (fullW <= 0 || fullH <= 0) return null
  const cx = displayBounds ? screenX - displayBounds.x : screenX
  const cy = displayBounds ? screenY - displayBounds.y : screenY
  const halfW = CROP_WIDTH / 2
  const halfH = CROP_HEIGHT / 2
  const srcX = Math.max(0, Math.min(fullW - CROP_WIDTH, cx - halfW))
  const srcY = Math.max(0, Math.min(fullH - CROP_HEIGHT, cy - halfH))
  const cropW = Math.min(CROP_WIDTH, fullW - srcX)
  const cropH = Math.min(CROP_HEIGHT, fullH - srcY)
  const canvas = document.createElement('canvas')
  canvas.width = cropW
  canvas.height = cropH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, srcX, srcY, cropW, cropH, 0, 0, cropW, cropH)
  const normalizedClickX = (cx - srcX) / cropW
  const normalizedClickY = (cy - srcY) / cropH
  return { dataUrl: canvas.toDataURL('image/png'), normalizedClickX, normalizedClickY }
}

/**
 * Result of captureRegionAroundClick: image as data URL and click position in normalized [0,1] coords within the crop.
 */
export interface CaptureResult {
  dataUrl: string
  normalizedClickX: number
  normalizedClickY: number
}

/**
 * Capture a cropped region of the screen around (screenX, screenY).
 * Reuses cached streams per display for low latency (grabFrame only).
 * Returns the image and click position in normalized coords, or null on failure.
 */
export async function captureRegionAroundClick(payload: CapturePayload): Promise<CaptureResult | null> {
  if (typeof window === 'undefined' || !window.capture?.getDesktopSources) {
    if (typeof window !== 'undefined' && window.capture?.sendCaptureFailed) {
      window.capture.sendCaptureFailed('Capture API not available')
    }
    return null
  }
  const { screenX, screenY, displayId, displayBounds } = payload
  let sources: DesktopSource[] = []
  try {
    sources = await window.capture.getDesktopSources()
    window.capture.log?.('getDesktopSources ok, count=' + sources.length)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    window.capture.sendCaptureFailed?.(`getDesktopSources failed: ${msg}`)
    return null
  }
  if (sources.length === 0) {
    window.capture.sendCaptureFailed?.('No desktop sources found')
    return null
  }
  const displayIdStr = displayId != null ? String(displayId) : ''
  const source = displayIdStr
    ? sources.find((s) => s.display_id === displayIdStr) ?? sources[0]
    : sources[0]
  if (!source) return null

  const ImageCaptureCtor = typeof ImageCapture !== 'undefined' && (window as unknown as { ImageCapture: typeof ImageCapture }).ImageCapture
  if (!ImageCaptureCtor?.prototype?.grabFrame) {
    window.capture.sendCaptureFailed?.('ImageCapture.grabFrame not available')
    return null
  }

  let entry: CachedEntry
  try {
    entry = await getOrCreateEntry(source.id, ImageCaptureCtor as new (t: MediaStreamTrack) => InstanceType<typeof ImageCapture>)
    window.capture.log?.('getUserMedia ok (cached or new)')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    window.capture.sendCaptureFailed?.(`Screen capture failed: ${msg}`)
    return null
  }

  try {
    const bitmap = await entry.imageCapture.grabFrame()
    window.capture.log?.('grabFrame ok ' + bitmap.width + 'x' + bitmap.height)
    const result = cropBitmapToResult(bitmap, screenX, screenY, displayBounds)
    bitmap.close()
    return result
  } catch (e) {
    window.capture.log?.('grabFrame failed, evicting and retrying once: ' + (e instanceof Error ? e.message : String(e)))
    streamCache.delete(source.id)
    entry.stream.getTracks().forEach((t) => t.stop())
    try {
      const freshEntry = await getOrCreateEntry(source.id, ImageCaptureCtor as new (t: MediaStreamTrack) => InstanceType<typeof ImageCapture>)
      const bitmap = await freshEntry.imageCapture.grabFrame()
      window.capture.log?.('grabFrame ok (retry) ' + bitmap.width + 'x' + bitmap.height)
      const result = cropBitmapToResult(bitmap, screenX, screenY, displayBounds)
      bitmap.close()
      return result
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      window.capture.sendCaptureFailed?.(`Capture failed: ${msg}`)
      return null
    }
  }
}
