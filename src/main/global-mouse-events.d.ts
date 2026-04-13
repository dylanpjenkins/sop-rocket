declare module 'global-mouse-events' {
  export function on(event: 'mousedown' | 'mouseup' | 'mousemove' | 'mousewheel', callback: (e: { x: number; y: number; button?: number; delta?: number; axis?: number }) => void): void
  export function pauseMouseEvents(): void
  export function resumeMouseEvents(): void
  export function getPaused(): boolean
}
