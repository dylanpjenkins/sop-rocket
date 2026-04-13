import { useEffect, useRef } from 'react'
import { captureRegionAroundClick, releaseStreamCache } from '@/lib/captureRegion'

/**
 * Renders when the app is loaded with ?capture=1 in a hidden capture window.
 * Listens for capture:doCapture from main, runs capture, sends result via capture:captureResult.
 * No UI; capture runs in a non-minimized window so getUserMedia works.
 */
export function CaptureWorker() {
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.capture?.onDoCaptureRequest || !window.capture?.sendCaptureResult) return
    unsubRef.current = window.capture.onDoCaptureRequest(async (payload) => {
      try {
        window.capture?.log?.('doCapture received')
        const result = await captureRegionAroundClick(payload)
        if (result) {
          window.capture?.log?.('sending captureResult')
          window.capture?.sendCaptureResult(result)
        } else {
          window.capture?.sendCaptureFailed?.('Capture returned no image')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        window.capture?.log?.(`capture error: ${msg}`)
        window.capture?.sendCaptureFailed?.(msg)
      }
    })
    window.capture?.sendWorkerReady?.()
    return () => {
      releaseStreamCache()
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  return <div style={{ display: 'none' }} aria-hidden />
}
