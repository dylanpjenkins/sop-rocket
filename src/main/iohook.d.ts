declare module 'iohook' {
  export function on(event: string, callback: (e: { button: number; x: number; y: number }) => void): void
  export function start(): void
  export function stop(): void
  export function removeAllListeners(event: string): void
}
