/** Close-to-hide, restore, and quiescent application exit coordination. */

export type QuitReason = 'menu' | 'tray' | 'window' | 'session-end'

export interface QuitCoordinator {
  isQuitting(): boolean
  requestQuit(reason: QuitReason): Promise<void>
  restartToUpdate(install: () => void): Promise<void>
}

export interface CreateQuitCoordinatorOptions {
  stopBackend: () => Promise<unknown>
  clearActiveRun: () => unknown
  destroyTray: () => void
  appQuit: () => void
}

export interface RestorableWindow {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export interface CloseEventLike {
  preventDefault(): void
}

export interface LifecycleWindowLike {
  hide(): void
  on(event: 'close', listener: (event: CloseEventLike) => void): void
}

export interface BindWindowCloseOptions {
  window: LifecycleWindowLike
  coordinator: QuitCoordinator
  trayAvailable: () => boolean
}

export interface LifecycleAppLike {
  on(event: 'before-quit', listener: (event: CloseEventLike) => void): void
  on(event: 'query-session-end', listener: () => void): void
}

export function handleWindowClose(state: { isQuitting: boolean; trayAvailable: boolean }): 'close' | 'hide' | 'quit' {
  if (state.isQuitting) return 'close'
  return state.trayAvailable ? 'hide' : 'quit'
}

export function restoreWindow(window: RestorableWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** Stop once and perform exactly one terminal action. */
export function createQuitCoordinator(options: CreateQuitCoordinatorOptions): QuitCoordinator {
  let quitting = false
  let quitPromise: Promise<void> | undefined

  const stopAndClean = async (): Promise<void> => {
    await options.stopBackend()
    options.clearActiveRun()
    options.destroyTray()
  }

  return {
    isQuitting: () => quitting,
    requestQuit: async (_reason) => {
      if (quitPromise !== undefined) return quitPromise
      quitting = true
      quitPromise = stopAndClean().then(() => { options.appQuit() })
      return quitPromise
    },
    restartToUpdate: async (install) => {
      if (quitPromise !== undefined) return quitPromise
      quitting = true
      quitPromise = stopAndClean().then(() => { install() })
      return quitPromise
    },
  }
}

export function bindWindowClose(options: BindWindowCloseOptions): void {
  options.window.on('close', (event) => {
    const action = handleWindowClose({
      isQuitting: options.coordinator.isQuitting(),
      trayAvailable: options.trayAvailable(),
    })
    if (action === 'close') return
    event.preventDefault()
    if (action === 'hide') options.window.hide()
    else void options.coordinator.requestQuit('window')
  })
}

/** Convert native quit requests into the same awaited backend shutdown path. */
export function bindApplicationLifecycle(app: LifecycleAppLike, coordinator: QuitCoordinator): void {
  app.on('before-quit', (event) => {
    if (coordinator.isQuitting()) return
    event.preventDefault()
    void coordinator.requestQuit('window')
  })
  app.on('query-session-end', () => {
    void coordinator.requestQuit('session-end')
  })
}
