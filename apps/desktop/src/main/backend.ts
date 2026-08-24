/**
 * The dsh web backend launcher: resolves the Node executable and the built dsh
 * CLI entry, spawns `dsh web --port <n>`, and surfaces a readiness promise that
 * resolves with the loopback URL. Kept Electron-free so the pure pieces are
 * unit-testable; the main process owns the window and its lifecycle.
 * @module @deepseek-ai/dsh-desktop/backend
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { findWebUrl } from './url.ts'

/**
 * Resolve the Node executable that runs the backend. The backend must run under
 * a real Node — never Electron's — because the harness spawns `process.execPath`
 * for its own child processes (sandbox runner, native directory picker).
 *
 * Precedence: `DSH_DESKTOP_NODE`, then the packaged app's bundled Node (when
 * `bundled` names an existing executable), then pnpm's `npm_node_execpath`
 * (set on every `pnpm run` script), then `node` from PATH.
 * @param env - process environment.
 * @param bundled - absolute path of the self-contained Node shipped beside the packaged app.
 * @returns the executable name or absolute path passed to `spawn`.
 */
export function resolveBackendNode(env: NodeJS.ProcessEnv, bundled?: string): string {
  return env.DSH_DESKTOP_NODE ?? bundled ?? env.npm_node_execpath ?? 'node'
}

/**
 * Resolve the built dsh CLI entry. The desktop app declares `@deepseek-ai/dsh`
 * as a dependency, so its `lib/bin.js` ships beside the shell in both the
 * workspace and the packaged app.
 * @param resolvePkgJson - injected specifier resolver (defaults to this module's require).
 * @returns the absolute path of the built CLI entry.
 */
export function resolveDshBin(
  resolvePkgJson: (specifier: string) => string = createRequire(import.meta.url).resolve,
): string {
  return join(dirname(resolvePkgJson('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
}

/** Options for {@link startBackend}. */
export interface StartBackendOptions {
  /** Node executable (from {@link resolveBackendNode}). */
  node: string
  /** Built dsh CLI entry (from {@link resolveDshBin}). */
  bin: string
  /** Real-filesystem backend root used as the child working directory. */
  cwd?: string
  /** Listen port; pass 0 to let the OS assign a free one. */
  port: number
  /** Environment for the backend process; defaults to the inherited environment. */
  env?: NodeJS.ProcessEnv
  /** Time allowed for the backend to print its readiness URL. */
  readinessTimeoutMs?: number
  /** Grace between SIGTERM and SIGKILL during shutdown. */
  stopGraceMs?: number
  /** Receives bounded backend output only before readiness. */
  onStartupOutput?: (chunk: string) => void
}

/** One terminal backend-process outcome. */
export interface BackendExit {
  /** Process exit code, or null when a signal ended it. */
  code: number | null
  /** Terminating signal, or null for an ordinary exit. */
  signal: NodeJS.Signals | null
  /** Whether the desktop shell requested this exit. */
  requested: boolean
}

/** A running backend and its readiness contract. */
export interface BackendProcess {
  /** The spawned child process. */
  child: ChildProcess
  /**
   * Resolves with the loopback URL once the backend prints its readiness line;
   * rejects when the backend fails to spawn or exits before that line.
   */
  ready: Promise<string>
  /** Resolves after the process exits and its stdio streams close. */
  done: Promise<BackendExit>
  /** Requests graceful shutdown, escalates after the grace, and awaits {@link done}. */
  stop(): Promise<BackendExit>
}

/** A promise with its resolve/reject functions exposed for later settlement. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/**
 * Spawn the dsh web backend and resolve its loopback URL from stdout.
 * @param options - node, bin, port, environment, and output sink.
 * @returns the child process and its readiness promise.
 */
export function startBackend(options: StartBackendOptions): BackendProcess {
  const child = spawn(options.node, [options.bin, 'web', '--port', String(options.port)], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const ready = deferred<string>()
  const done = deferred<BackendExit>()
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 90_000
  const stopGraceMs = options.stopGraceMs ?? 3_000
  let readySettled = false
  let doneSettled = false
  let stopRequested = false
  const settleReady = (action: () => void): void => {
    if (readySettled) return
    readySettled = true
    clearTimeout(readinessTimer)
    action()
  }
  const settleDone = (action: () => void): void => {
    if (doneSettled) return
    doneSettled = true
    action()
  }
  const emitStartupOutput = (chunk: string): void => {
    try {
      options.onStartupOutput?.(chunk)
    } catch (error: unknown) {
      process.stderr.write(`dsh desktop: startup output listener failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  const readinessTimer = setTimeout(() => {
    settleReady(() => {
      ready.reject(new Error(`dsh desktop backend was not ready within ${String(readinessTimeoutMs)} ms`))
    })
  }, readinessTimeoutMs)

  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
    const url = findWebUrl(stdout)
    if (url !== undefined) {
      settleReady(() => { ready.resolve(url) })
      return
    }
    if (!readySettled) emitStartupOutput(chunk)
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (!readySettled) emitStartupOutput(chunk)
  })

  child.once('error', (error) => {
    settleReady(() => { ready.reject(error) })
    settleDone(() => { done.reject(error) })
  })
  child.once('close', (code, signal) => {
    const result = { code, signal, requested: stopRequested }
    const detail = signal === null ? `code ${String(code)}` : `signal ${signal}`
    settleReady(() => { ready.reject(new Error(`dsh desktop backend exited before readiness (${detail})`)) })
    settleDone(() => { done.resolve(result) })
  })

  const stop = async (): Promise<BackendExit> => {
    stopRequested = true
    if (child.exitCode !== null || child.signalCode !== null) return done.promise
    child.kill('SIGTERM')
    const force = setTimeout(() => { child.kill('SIGKILL') }, stopGraceMs)
    try {
      return await done.promise
    } finally {
      clearTimeout(force)
    }
  }

  return { child, ready: ready.promise, done: done.promise, stop }
}
