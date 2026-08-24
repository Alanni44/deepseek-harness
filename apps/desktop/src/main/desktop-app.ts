/** Testable startup and recovery sequence for the desktop shell. */

import type { BackendExit, BackendProcess } from './backend.ts'
import type { StartupStage } from './health.ts'

export type StartupRecoveryAction = 'retry' | 'export-diagnostics' | 'open-logs' | 'quit'

export interface StartupWindow {
  loadLoading(stage: StartupStage, version: string): Promise<void>
  setStage(stage: StartupStage, version: string): Promise<void>
  loadMain(url: string): Promise<void>
}

export interface DesktopAppMenuResult {
  trayAvailable: boolean
}

export interface DesktopAppOptions {
  desktopVersion: string
  createWindow: () => StartupWindow
  startBackend: () => BackendProcess
  markHealthy: () => void
  createMenus: (window: StartupWindow, backend: BackendProcess) => DesktopAppMenuResult
  bindLifecycle: (input: { window: StartupWindow; backend: BackendProcess; menus: DesktopAppMenuResult }) => void
  checkForUpdatesInBackground: () => Promise<void>
  showStartupRecovery: (error: Error) => Promise<StartupRecoveryAction>
  exportDiagnostics: () => Promise<unknown>
  openLogs: () => Promise<unknown>
  quitWithoutBackend: () => Promise<void>
  onBackendExit: (exit: BackendExit) => Promise<void>
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Display immediately, retry only on user request, and return after healthy setup. */
export async function runDesktopApp(options: DesktopAppOptions): Promise<void> {
  const window = options.createWindow()
  await window.loadLoading('starting-service', options.desktopVersion)
  for (;;) {
    const backend = options.startBackend()
    try {
      const url = await backend.ready
      await window.setStage('loading-interface', options.desktopVersion)
      await window.loadMain(url)
      options.markHealthy()
      const menus = options.createMenus(window, backend)
      options.bindLifecycle({ window, backend, menus })
      void backend.done.then(async (exit) => {
        if (!exit.requested) await options.onBackendExit(exit)
      })
      void options.checkForUpdatesInBackground()
      return
    } catch (error) {
      await backend.stop()
      await window.setStage('failed', options.desktopVersion)
      const action = await options.showStartupRecovery(asError(error))
      if (action === 'export-diagnostics') await options.exportDiagnostics()
      else if (action === 'open-logs') await options.openLogs()
      else if (action === 'quit') {
        await options.quitWithoutBackend()
        return
      } else {
        await window.setStage('starting-service', options.desktopVersion)
      }
    }
  }
}
