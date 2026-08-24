/** Installed-build-only electron-updater state machine. */

import type { QuitCoordinator } from './lifecycle.ts'
import { redactText } from './logging.ts'

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'current'
  | 'error'

export interface UpdateEventMap {
  'checking-for-update': undefined
  'update-available': { version: string }
  'update-not-available': undefined
  'download-progress': { percent: number }
  'update-downloaded': { version: string }
  'error': Error
}

export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on<Event extends keyof UpdateEventMap>(event: Event, listener: (payload: UpdateEventMap[Event]) => void): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateDialogLike {
  showMessageBox(options: {
    type: 'info' | 'error'
    title: string
    message: string
    detail?: string
    buttons: string[]
    defaultId: number
    cancelId: number
  }): Promise<{ response: number }>
}

export interface UpdateWindowLike {
  setProgressBar(progress: number): void
}

export interface UpdateLoggerLike {
  info(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export interface UpdateManagerOptions {
  packaged: boolean
  env: NodeJS.ProcessEnv
  updater: UpdaterLike
  dialog: UpdateDialogLike
  window: UpdateWindowLike
  logger: UpdateLoggerLike
  quitCoordinator: QuitCoordinator
}

export interface UpdateManager {
  state(): UpdateState
  check(manual: boolean): Promise<void>
  download(): Promise<void>
  restart(): Promise<void>
}

function disabledUpdateManager(): UpdateManager {
  return {
    state: () => 'disabled',
    check: () => Promise.resolve(),
    download: () => Promise.resolve(),
    restart: () => Promise.resolve(),
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Own all updater events and user prompts without exposing updater APIs to the renderer. */
export function createUpdateManager(options: UpdateManagerOptions): UpdateManager {
  if (!options.packaged || options.env.DSH_DESKTOP_DISABLE_UPDATES === '1') return disabledUpdateManager()

  let currentState: UpdateState = 'idle'
  let manualCheck = false
  options.updater.autoDownload = false
  options.updater.autoInstallOnAppQuit = false

  const showError = async (error: Error): Promise<void> => {
    if (!manualCheck) return
    const result = await options.dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness Update',
      message: 'Unable to check for updates.',
      detail: redactText(error.message),
      buttons: ['Retry', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0) await check(true)
  }

  const handleError = (error: unknown): void => {
    const normalized = asError(error)
    currentState = 'error'
    options.window.setProgressBar(-1)
    options.logger.error('update-error', { message: redactText(normalized.message) })
    void showError(normalized)
  }

  options.updater.on('checking-for-update', () => {
    currentState = 'checking'
    options.logger.info('update-checking', { manual: manualCheck })
  })
  options.updater.on('update-available', (info) => {
    currentState = 'available'
    options.logger.info('update-available', { version: info.version })
    void options.dialog.showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness Update',
      message: `Version ${info.version} is available.`,
      detail: 'Download it now? You can keep using the current version until you restart.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(async (result) => {
      if (result.response === 0) await download()
    }).catch(handleError)
  })
  options.updater.on('update-not-available', () => {
    currentState = 'current'
    options.logger.info('update-current')
    if (!manualCheck) return
    void options.dialog.showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness Update',
      message: 'DeepSeek Harness is up to date.',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
    }).catch(handleError)
  })
  options.updater.on('download-progress', ({ percent }) => {
    currentState = 'downloading'
    options.window.setProgressBar(Math.max(0, Math.min(percent, 100)) / 100)
  })
  options.updater.on('update-downloaded', (info) => {
    currentState = 'downloaded'
    options.window.setProgressBar(-1)
    options.logger.info('update-downloaded', { version: info.version })
    void options.dialog.showMessageBox({
      type: 'info',
      title: 'DeepSeek Harness Update',
      message: `Version ${info.version} is ready to install.`,
      detail: 'Restart now to finish updating. The local service will stop cleanly first.',
      buttons: ['Restart to Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(async (result) => {
      if (result.response === 0) await restart()
    }).catch(handleError)
  })
  options.updater.on('error', handleError)

  async function check(manual: boolean): Promise<void> {
    manualCheck = manual
    currentState = 'checking'
    try {
      await options.updater.checkForUpdates()
    } catch (error) {
      handleError(error)
    }
  }

  async function download(): Promise<void> {
    currentState = 'downloading'
    try {
      await options.updater.downloadUpdate()
    } catch (error) {
      handleError(error)
    }
  }

  async function restart(): Promise<void> {
    if (currentState !== 'downloaded') throw new Error('desktop update is not ready to install')
    await options.quitCoordinator.restartToUpdate(() => { options.updater.quitAndInstall(false, true) })
  }

  return { state: () => currentState, check, download, restart }
}
