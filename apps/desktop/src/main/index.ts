/** Electron composition root for the productized DeepSeek Harness desktop app. */

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  shell,
  Tray,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { release as osRelease } from 'node:os'
import { join } from 'node:path'
import { startBackend, type BackendExit, type BackendProcess } from './backend.ts'
import { runDesktopApp, type StartupRecoveryAction } from './desktop-app.ts'
import { exportDiagnostics, type DiagnosticOptions } from './diagnostics.ts'
import {
  activeRunPath,
  beginRun,
  clearActiveRun,
  lastHealthyPath,
  markRunHealthy,
  type HealthOptions,
  type StartupStage,
} from './health.ts'
import {
  bindApplicationLifecycle,
  bindWindowClose,
  createQuitCoordinator,
  restoreWindow,
  type LifecycleAppLike,
  type LifecycleWindowLike,
  type QuitCoordinator,
} from './lifecycle.ts'
import { createDesktopLogger, pruneLogs } from './logging.ts'
import { createDesktopMenus, type MenuTemplate, type TrayLike } from './menu.ts'
import { resolveRuntimePaths } from './runtime.ts'
import { createUpdateManager, type UpdateManager, type UpdaterLike } from './updater.ts'
import { createMainWindow, type DesktopWindow } from './window.ts'

const PRODUCT_NAME = 'DeepSeek Harness'
const APP_USER_MODEL_ID = 'ai.deepseek.dsh.desktop'

interface UpstreamRecord {
  repository: string
  commit: string
  sourceVersion: string
  desktopVersion: string
}

function readUpstreamRecord(path: string): UpstreamRecord {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof value !== 'object' || value === null) throw new Error('desktop upstream record is not an object')
  const record = value as Record<string, unknown>
  for (const field of ['repository', 'commit', 'sourceVersion', 'desktopVersion'] as const) {
    if (typeof record[field] !== 'string') throw new Error(`desktop upstream field ${field} is invalid`)
  }
  return record as unknown as UpstreamRecord
}

function recoveryAction(response: number): StartupRecoveryAction {
  if (response === 0) return 'retry'
  if (response === 1) return 'export-diagnostics'
  if (response === 2) return 'open-logs'
  return 'quit'
}

async function main(): Promise<void> {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  const appPath = app.getAppPath()
  const packagedRequire = createRequire(join(process.resourcesPath, 'backend', 'package.json'))
  const developmentRequire = createRequire(import.meta.url)
  const paths = resolveRuntimePaths({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath,
    env: process.env,
    resolvePackageJson: specifier => (app.isPackaged ? packagedRequire : developmentRequire).resolve(specifier),
  })
  const upstream = readUpstreamRecord(join(appPath, 'upstream.json'))
  const logDirectory = app.getPath('logs')
  const logger = createDesktopLogger({ directory: logDirectory })
  const healthDirectory = join(app.getPath('userData'), 'desktop-health')
  const health: HealthOptions = {
    directory: healthDirectory,
    record: {
      runId: randomUUID(),
      desktopVersion: upstream.desktopVersion,
      sourceVersion: upstream.sourceVersion,
      upstreamCommit: upstream.commit,
      stage: 'starting-service',
      startedAt: new Date().toISOString(),
    },
    now: () => new Date(),
  }
  const previousRun = beginRun(health)
  let startupStage: StartupStage = 'starting-service'
  let mainWindow: DesktopWindow | undefined
  let activeTray: TrayLike | undefined
  let activeCoordinator: QuitCoordinator | undefined
  let updateManager: UpdateManager | undefined

  logger.info('desktop-start', {
    desktopVersion: upstream.desktopVersion,
    sourceVersion: upstream.sourceVersion,
    upstreamCommit: upstream.commit,
    previousRunDetected: previousRun !== undefined,
  })

  const currentDiagnosticOptions = (): DiagnosticOptions => ({
    metadata: {
      desktopVersion: upstream.desktopVersion,
      sourceVersion: upstream.sourceVersion,
      upstreamRepository: upstream.repository,
      upstreamCommit: upstream.commit,
      startupStage,
      previousRunDetected: previousRun !== undefined,
      platform: process.platform,
      arch: process.arch,
      osRelease: osRelease(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
    },
    logDirectory,
    logFiles: pruneLogs({ directory: logDirectory }).files.map(file => file.path),
    activeRunPath: activeRunPath(healthDirectory),
    lastHealthyPath: lastHealthyPath(healthDirectory),
  })

  const exportCurrentDiagnostics = async (): Promise<void> => {
    const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-')
    const destination = await exportDiagnostics({
      diagnostics: currentDiagnosticOptions(),
      defaultPath: join(app.getPath('downloads'), `DeepSeek-Harness-diagnostics-${stamp}.zip`),
      dialog: {
        showMessageBox: async options => dialog.showMessageBox(options),
        showSaveDialog: async options => dialog.showSaveDialog(options),
      },
    })
    if (destination !== undefined) logger.info('diagnostics-exported')
  }

  const openLogs = async (): Promise<void> => {
    const error = await shell.openPath(logDirectory)
    if (error !== '') logger.warn('open-logs-failed', { message: error })
  }

  const showRecovery = async (error: Error): Promise<StartupRecoveryAction> => {
    logger.error('desktop-startup-failed', { message: error.message })
    const result = await dialog.showMessageBox({
      type: 'error',
      title: PRODUCT_NAME,
      message: 'DeepSeek Harness could not finish starting.',
      detail: `${error.message}\n\nNo profiles, plugins, sessions, or user files were changed.`,
      buttons: ['Retry', 'Export Diagnostics', 'Open Logs', 'Quit'],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    })
    return recoveryAction(result.response)
  }

  const handleBackendExit = async (exit: BackendExit): Promise<void> => {
    logger.error('backend-unexpected-exit', { code: exit.code, signal: exit.signal })
    startupStage = 'failed'
    if (mainWindow !== undefined) await mainWindow.setStage('failed', upstream.desktopVersion)
    for (;;) {
      const message = `The local service exited (code ${String(exit.code)}, signal ${String(exit.signal)}).`
      const action = await showRecovery(new Error(message))
      if (action === 'export-diagnostics') await exportCurrentDiagnostics()
      else if (action === 'open-logs') await openLogs()
      else {
        if (action === 'retry') app.relaunch()
        await activeCoordinator?.requestQuit(action === 'retry' ? 'window' : 'menu')
        return
      }
    }
  }

  app.on('second-instance', () => {
    if (mainWindow !== undefined) restoreWindow(mainWindow.native)
  })

  await runDesktopApp({
    desktopVersion: upstream.desktopVersion,
    createWindow: () => {
      const window = createMainWindow({
        createBrowserWindow: options => new BrowserWindow(options),
        loadingHtml: paths.loadingHtml,
        icon: paths.icon,
        openExternal: url => shell.openExternal(url),
      })
      mainWindow = window
      return {
        loadLoading: async (stage, version) => {
          startupStage = stage
          logger.info('startup-stage', { stage })
          await window.loadLoading(stage, version)
        },
        setStage: async (stage, version) => {
          startupStage = stage
          logger.info('startup-stage', { stage })
          await window.setStage(stage, version)
        },
        loadMain: async url => window.loadMain(url),
      }
    },
    startBackend: (): BackendProcess => startBackend({
      node: paths.node,
      bin: paths.dshBin,
      cwd: paths.backendRoot,
      port: 0,
      onStartupOutput: (chunk) => { logger.info('backend-startup-output', { message: chunk }) },
    }),
    markHealthy: () => {
      startupStage = 'ready'
      markRunHealthy(health)
      logger.info('desktop-ready')
    },
    createMenus: () => {
      const menus = createDesktopMenus({
        productName: PRODUCT_NAME,
        desktopVersion: upstream.desktopVersion,
        trayImage: nativeTheme.shouldUseDarkColors ? paths.trayDark : paths.trayLight,
        commands: {
          show: () => { if (mainWindow !== undefined) restoreWindow(mainWindow.native) },
          checkForUpdates: async () => { await updateManager?.check(true) },
          exportDiagnostics: exportCurrentDiagnostics,
          quit: async () => { await activeCoordinator?.requestQuit('tray') },
        },
        buildMenu: (template: MenuTemplate) => Menu.buildFromTemplate(template),
        setApplicationMenu: (menu) => { Menu.setApplicationMenu(menu as Menu) },
        createTray: image => new Tray(image),
        onTrayError: (error) => { logger.error('tray-create-failed', { message: error.message }) },
        onCommandError: (error) => { logger.error('desktop-command-failed', { message: error.message }) },
      })
      activeTray = menus.tray
      return { trayAvailable: menus.tray !== undefined }
    },
    bindLifecycle: ({ backend, menus }) => {
      if (mainWindow === undefined) throw new Error('desktop window disappeared before lifecycle binding')
      const coordinator = createQuitCoordinator({
        stopBackend: async () => backend.stop(),
        clearActiveRun: () => clearActiveRun(health),
        destroyTray: () => {
          activeTray?.destroy()
          activeTray = undefined
        },
        appQuit: () => { app.quit() },
      })
      activeCoordinator = coordinator
      updateManager = createUpdateManager({
        packaged: app.isPackaged,
        env: process.env,
        updater: autoUpdater as unknown as UpdaterLike,
        dialog: { showMessageBox: async options => dialog.showMessageBox(options) },
        window: mainWindow.native,
        logger,
        quitCoordinator: coordinator,
      })
      bindWindowClose({
        window: mainWindow.native as unknown as LifecycleWindowLike,
        coordinator,
        trayAvailable: () => menus.trayAvailable,
      })
      bindApplicationLifecycle(app as unknown as LifecycleAppLike, coordinator)
    },
    checkForUpdatesInBackground: async () => { await updateManager?.check(false) },
    showStartupRecovery: showRecovery,
    exportDiagnostics: exportCurrentDiagnostics,
    openLogs,
    quitWithoutBackend: () => {
      app.quit()
      return Promise.resolve()
    },
    onBackendExit: handleBackendExit,
  })

}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(main).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(PRODUCT_NAME, message)
    app.quit()
  })
}
