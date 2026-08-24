/** Secure BrowserWindow adapter for local loading and exact-origin app content. */

import type { StartupStage } from './health.ts'
import { isAllowedAppNavigation } from './url.ts'

export interface WindowOpenResult {
  action: 'deny'
}

export interface NativeWebContentsLike {
  setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResult): void
  on(event: 'will-navigate', handler: (event: { preventDefault(): void }, target: string) => void): void
}

export interface NativeWindowLike {
  webContents: NativeWebContentsLike
  loadFile(path: string, options?: { query: Record<string, string> }): Promise<unknown>
  loadURL(url: string): Promise<unknown>
  show(): void
  hide(): void
  focus(): void
  restore(): void
  isMinimized(): boolean
  setProgressBar(progress: number): void
  on(event: string, listener: (...args: unknown[]) => void): void
  once(event: string, listener: (...args: unknown[]) => void): void
}

export interface NativeWindowOptions {
  width: number
  height: number
  show: boolean
  title: string
  icon: string
  webPreferences: {
    contextIsolation: boolean
    nodeIntegration: boolean
    sandbox: boolean
  }
}

export interface CreateMainWindowOptions {
  createBrowserWindow: (options: NativeWindowOptions) => NativeWindowLike
  loadingHtml: string
  icon: string
  openExternal: (url: string) => Promise<unknown>
}

export interface DesktopWindow {
  native: NativeWindowLike
  loadLoading(stage: StartupStage, version: string): Promise<void>
  setStage(stage: StartupStage, version: string): Promise<void>
  loadMain(url: string): Promise<void>
}

function isSafeExternalUrl(target: string): boolean {
  try {
    const protocol = new URL(target).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Create one window that transitions from the local loader to the dsh origin. */
export function createMainWindow(options: CreateMainWindowOptions): DesktopWindow {
  const native = options.createBrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    title: 'DeepSeek Harness',
    icon: options.icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  let appUrl: string | undefined
  native.once('ready-to-show', () => { native.show() })
  native.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void options.openExternal(url)
    return { action: 'deny' }
  })
  native.webContents.on('will-navigate', (event, target) => {
    if (appUrl !== undefined && isAllowedAppNavigation(appUrl, target)) return
    event.preventDefault()
    if (isSafeExternalUrl(target)) void options.openExternal(target)
  })

  const loadLoading = async (stage: StartupStage, version: string): Promise<void> => {
    appUrl = undefined
    await native.loadFile(options.loadingHtml, { query: { stage, version } })
  }

  return {
    native,
    loadLoading,
    setStage: loadLoading,
    loadMain: async (url) => {
      appUrl = url
      await native.loadURL(url)
    },
  }
}
