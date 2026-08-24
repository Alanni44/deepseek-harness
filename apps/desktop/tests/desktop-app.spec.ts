import { describe, expect, it, vi } from 'vitest'
import { runDesktopApp, type DesktopAppOptions, type StartupRecoveryAction } from '../src/main/desktop-app.ts'
import type { BackendProcess } from '../src/main/backend.ts'

function backend(url: string): BackendProcess {
  const exit = { code: null, signal: 'SIGTERM' as const, requested: true }
  return {
    child: {} as BackendProcess['child'],
    ready: Promise.resolve(url),
    done: new Promise(() => undefined),
    stop: vi.fn(async () => exit),
  }
}

function harness(): { events: string[]; options: DesktopAppOptions } {
  const events: string[] = []
  const window = {
    loadLoading: vi.fn(async (stage: string) => { events.push(`window:load-loading:${stage}`) }),
    setStage: vi.fn(async (stage: string) => { events.push(`window:stage:${stage}`) }),
    loadMain: vi.fn(async (url: string) => { events.push(`window:load-main:${url}`) }),
  }
  return {
    events,
    options: {
      desktopVersion: '0.1.0-rc.7',
      createWindow: () => { events.push('window:create'); return window },
      startBackend: () => { events.push('backend:start'); return backend('http://127.0.0.1:3080') },
      markHealthy: () => { events.push('health:mark-ready') },
      createMenus: () => { events.push('tray:create'); return { trayAvailable: true } },
      bindLifecycle: () => { events.push('lifecycle:bind') },
      checkForUpdatesInBackground: async () => { events.push('updater:background-check') },
      showStartupRecovery: vi.fn(async (): Promise<StartupRecoveryAction> => 'quit'),
      exportDiagnostics: vi.fn(async () => undefined),
      openLogs: vi.fn(async () => undefined),
      quitWithoutBackend: vi.fn(async () => undefined),
      onBackendExit: vi.fn(async () => undefined),
    },
  }
}

describe('desktop startup orchestration', () => {
  it('shows loading immediately, loads the same window, then creates the tray', async () => {
    const app = harness()
    await runDesktopApp(app.options)
    expect(app.events).toEqual([
      'window:create',
      'window:load-loading:starting-service',
      'backend:start',
      'window:stage:loading-interface',
      'window:load-main:http://127.0.0.1:3080',
      'health:mark-ready',
      'tray:create',
      'lifecycle:bind',
      'updater:background-check',
    ])
  })

  it('keeps recovery actions in the same visible window and retries explicitly', async () => {
    const app = harness()
    const failed = backend('unused')
    const stopFailedBackend = vi.fn(async () => ({ code: null, signal: 'SIGTERM' as const, requested: true }))
    failed.stop = stopFailedBackend
    failed.ready = Promise.reject(new Error('startup failed'))
    const healthy = backend('http://127.0.0.1:3080')
    const startBackend = vi.fn()
      .mockReturnValueOnce(failed)
      .mockReturnValueOnce(failed)
      .mockReturnValueOnce(healthy)
    const actions: StartupRecoveryAction[] = ['export-diagnostics', 'retry']
    app.options.startBackend = startBackend
    app.options.showStartupRecovery = vi.fn(async () => actions.shift() ?? 'quit')

    await runDesktopApp(app.options)

    const exportDiagnostics = vi.mocked(app.options.exportDiagnostics)
    expect(exportDiagnostics).toHaveBeenCalledOnce()
    expect(stopFailedBackend).toHaveBeenCalledTimes(2)
    expect(startBackend).toHaveBeenCalledTimes(3)
    expect(app.events).toContain('window:load-main:http://127.0.0.1:3080')
  })
})
