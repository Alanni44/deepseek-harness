/**
 * Electron main process for the dsh desktop shell. It boots the dsh web backend
 * as a child process, waits for the backend's readiness line, then opens a
 * native window on the loopback URL. Window and backend lifetimes are coupled:
 * closing the window stops the backend, and a backend crash closes the window.
 * @module @deepseek-ai/dsh-desktop
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBackendNode, resolveDshBin, startBackend, type BackendProcess } from './backend.ts'

/** Grace before a backend that ignores SIGTERM is force-killed. */
const BACKEND_STOP_GRACE_MS = 3_000

/** The self-contained Node shipped beside the packaged app, when present. */
function bundledNode(): string | undefined {
  if (!app.isPackaged) return undefined
  const candidate = join(process.resourcesPath, 'node', 'node.exe')
  return existsSync(candidate) ? candidate : undefined
}

/**
 * Stop a backend child process: SIGTERM first, then SIGKILL after the grace
 * period. Resolves once the child has exited (or was never started).
 * @param child - the backend child process.
 */
function stopBackend(child: BackendProcess['child']): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const force = setTimeout(() => { child.kill('SIGKILL'); resolve() }, BACKEND_STOP_GRACE_MS)
    child.once('exit', () => { clearTimeout(force); resolve() })
    child.kill('SIGTERM')
  })
}

let mainWindow: BrowserWindow | undefined
let backend: BackendProcess | undefined

/** Open the window on a backend loopback URL. */
function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    title: 'DeepSeek Harness',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  // New windows and off-app navigations leave the shell; the app's own SPA
  // navigation stays same-origin and keeps rendering in place.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (target === url || target.startsWith(`${url}/`)) return
    event.preventDefault()
    void shell.openExternal(target)
  })
  void window.loadURL(url)
  return window
}

/** Report a fatal startup failure and exit. */
function fail(message: string): void {
  backend = undefined
  dialog.showErrorBox('DeepSeek Harness', message)
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    const node = resolveBackendNode(process.env, bundledNode())
    const bin = process.env.DSH_DESKTOP_DSH_BIN ?? resolveDshBin()
    backend = startBackend({
      node,
      bin,
      port: 0,
      onStartupOutput: (chunk) => { process.stderr.write(chunk) },
    })

    backend.ready.then(
      (url) => {
        mainWindow = createWindow(url)
        mainWindow.on('closed', () => { mainWindow = undefined })
      },
      (error: unknown) => { fail(error instanceof Error ? error.message : String(error)) },
    )

    backend.child.on('exit', (code, signal) => {
      // A backend that dies after readiness leaves the window with nothing to
      // talk to; closing it quits the app. During our own quit the window is
      // already gone, so this is a no-op on the normal path.
      if (mainWindow === undefined) return
      process.stderr.write(`dsh desktop: backend exited (code ${String(code)}, signal ${String(signal)})\n`)
      mainWindow.close()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (backend === undefined) return
    const child = backend.child
    backend = undefined
    if (child.exitCode === null && child.signalCode === null) {
      event.preventDefault()
      void stopBackend(child).then(() => { app.quit() })
    }
  })
}
