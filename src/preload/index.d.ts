export interface YardarmApi {
  platform: NodeJS.Platform
  versions: { electron: string; node: string }
  send: (channel: string, ...args: unknown[]) => void
}

declare global {
  interface Window {
    yardarm: YardarmApi
  }
}

export {}
