import { describe, expect, it, vi } from 'vitest'
import {
  createMainWindow,
  type NativeWindowLike,
  type NativeWindowOptions,
  type WindowOpenResult,
} from '../src/main/window.ts'

function windowHarness() {
  const events = new Map<string, (...args: unknown[]) => void>()
  let openHandler: ((details: { url: string }) => WindowOpenResult) | undefined
  let navigateHandler: ((event: { preventDefault(): void }, target: string) => void) | undefined
  const loadFile = vi.fn(async (_path: string, _options?: { query: Record<string, string> }) => undefined)
  const loadURL = vi.fn(async (_url: string) => undefined)
  const native: NativeWindowLike = {
    loadFile,
    loadURL,
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn(() => false),
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => { events.set(name, listener) }),
    once: vi.fn((name: string, listener: (...args: unknown[]) => void) => { events.set(name, listener) }),
    webContents: {
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => WindowOpenResult) => { openHandler = handler }),
      on: vi.fn((_name: 'will-navigate', handler: (event: { preventDefault(): void }, target: string) => void) => { navigateHandler = handler }),
    },
  }
  const createBrowserWindow = vi.fn((_options: NativeWindowOptions) => native)
  const openExternal = vi.fn(async (_url: string) => undefined)
  return {
    native,
    loadFile,
    loadURL,
    createBrowserWindow,
    openExternal,
    events,
    getOpenHandler: () => openHandler,
    getNavigateHandler: () => navigateHandler,
  }
}

describe('desktop main window', () => {
  it('shows a privilege-free loading page immediately and transitions the same secure window', async () => {
    const harness = windowHarness()
    const window = createMainWindow({
      createBrowserWindow: harness.createBrowserWindow,
      loadingHtml: 'C:/app/assets/loading.html',
      icon: 'C:/app/build/icon.png',
      openExternal: harness.openExternal,
    })

    expect(harness.createBrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      icon: 'C:/app/build/icon.png',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    }))
    await window.loadLoading('starting-service', '0.1.0-rc.7')
    await window.setStage('loading-interface', '0.1.0-rc.7')
    await window.loadMain('http://127.0.0.1:3080')

    expect(harness.loadFile).toHaveBeenNthCalledWith(1, 'C:/app/assets/loading.html', {
      query: { stage: 'starting-service', version: '0.1.0-rc.7' },
    })
    expect(harness.loadFile).toHaveBeenNthCalledWith(2, 'C:/app/assets/loading.html', {
      query: { stage: 'loading-interface', version: '0.1.0-rc.7' },
    })
    expect(harness.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3080')
  })

  it('keeps exact-origin navigation inside and sends external HTTP links to the system', async () => {
    const harness = windowHarness()
    const window = createMainWindow({
      createBrowserWindow: harness.createBrowserWindow,
      loadingHtml: 'C:/app/assets/loading.html',
      icon: 'C:/app/build/icon.png',
      openExternal: harness.openExternal,
    })
    await window.loadMain('http://127.0.0.1:3080')
    const preventDefault = vi.fn()

    harness.getNavigateHandler()?.({ preventDefault }, 'http://127.0.0.1:3080/session/1')
    expect(preventDefault).not.toHaveBeenCalled()
    harness.getNavigateHandler()?.({ preventDefault }, 'https://example.com/')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(harness.openExternal).toHaveBeenCalledWith('https://example.com/')
    expect(harness.getOpenHandler()?.({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
  })
})
