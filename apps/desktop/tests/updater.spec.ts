import { describe, expect, it, vi } from 'vitest'
import {
  createUpdateManager,
  type UpdateEventMap,
  type UpdateManagerOptions,
  type UpdaterLike,
} from '../src/main/updater.ts'

class FakeUpdater implements UpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = true
  readonly checkForUpdates = vi.fn(async () => undefined)
  readonly downloadUpdate = vi.fn(async () => undefined)
  readonly quitAndInstall = vi.fn()
  private readonly listeners = new Map<keyof UpdateEventMap, Array<(payload: never) => void>>()

  on<Event extends keyof UpdateEventMap>(event: Event, listener: (payload: UpdateEventMap[Event]) => void): void {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  emit<Event extends keyof UpdateEventMap>(event: Event, payload: UpdateEventMap[Event]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload as never)
  }
}

function harness(overrides: Partial<UpdateManagerOptions> = {}) {
  const updater = new FakeUpdater()
  const showMessageBox = vi.fn(async () => ({ response: 1 }))
  const setProgressBar = vi.fn((_progress: number) => undefined)
  const logError = vi.fn((_event: string, _fields?: Record<string, unknown>) => undefined)
  const restartToUpdate = vi.fn(async (install: () => void) => { install() })
  const options: UpdateManagerOptions = {
    packaged: true,
    env: {},
    updater,
    dialog: { showMessageBox },
    window: { setProgressBar },
    logger: { error: logError, info: vi.fn() },
    quitCoordinator: {
      isQuitting: () => false,
      requestQuit: vi.fn(async () => undefined),
      restartToUpdate,
    },
    ...overrides,
  }
  return { updater, showMessageBox, setProgressBar, logError, restartToUpdate, options }
}

describe('installed app updater', () => {
  it('disables updating outside installed production or through the explicit environment switch', () => {
    expect(createUpdateManager(harness({ packaged: false }).options).state()).toBe('disabled')
    expect(createUpdateManager(harness({ env: { DSH_DESKTOP_DISABLE_UPDATES: '1' } }).options).state()).toBe('disabled')
  })

  it('checks without auto-downloading and offers download, progress, defer, then restart', async () => {
    const app = harness()
    const manager = createUpdateManager(app.options)

    await manager.check(true)
    app.updater.emit('update-available', { version: '0.1.0-rc.7.2' })
    await Promise.resolve()
    expect(app.updater.autoDownload).toBe(false)
    expect(app.showMessageBox.mock.calls.at(-1)?.[0]?.buttons).toEqual(['Download', 'Later'])

    await manager.download()
    app.updater.emit('download-progress', { percent: 42 })
    expect(app.setProgressBar).toHaveBeenLastCalledWith(0.42)
    app.updater.emit('update-downloaded', { version: '0.1.0-rc.7.2' })
    await Promise.resolve()
    await manager.restart()
    expect(app.restartToUpdate).toHaveBeenCalledWith(expect.any(Function))
    expect(app.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('logs a background network failure without interruption and shows a manual failure', async () => {
    const app = harness()
    const manager = createUpdateManager(app.options)

    await manager.check(false)
    app.updater.emit('error', new Error('offline TOKEN=private'))
    await Promise.resolve()
    expect(app.showMessageBox).not.toHaveBeenCalled()
    expect(app.logError).toHaveBeenCalledWith('update-error', { message: 'offline TOKEN=[REDACTED]' })

    await manager.check(true)
    app.updater.emit('error', new Error('offline'))
    await Promise.resolve()
    expect(app.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('reports the installed version as current only for a manual check', async () => {
    const app = harness()
    const manager = createUpdateManager(app.options)

    await manager.check(false)
    app.updater.emit('update-not-available', undefined)
    await Promise.resolve()
    expect(app.showMessageBox).not.toHaveBeenCalled()
    await manager.check(true)
    app.updater.emit('update-not-available', undefined)
    await Promise.resolve()
    expect(app.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: 'DeepSeek Harness is up to date.' }))
  })
})
