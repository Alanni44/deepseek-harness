# DeepSeek Harness Desktop Productization Implementation Plan

English | [中文](2026-08-24-desktop-productization.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Windows Electron prototype into an install-only desktop product with immediate loading feedback, tray persistence, in-app GitHub Release updates, reproducible publishing, a verified packaged runtime, and a materially smaller installation.

**Architecture:** Electron remains a thin main-process shell in `app.asar`; it starts the built `dsh web` CLI under a separately shipped standard Node executable and a pnpm-deployed production dependency closure in `resources/backend`. Focused main-process modules own startup, lifecycle, diagnostics, health, and updating, while GitHub Actions verifies the recorded official upstream baseline and publishes only NSIS update artifacts from `desktop-v<version>` tags.

**Tech Stack:** TypeScript 6, Electron 43, electron-builder 26, electron-updater 6, Vitest 4, pnpm 11, Node 24, NSIS, GitHub Actions, PowerShell on Windows.

## Global Constraints

- Preserve the separate standard Node backend; never run the backend in Electron main, Electron's Node runtime, or `runAsNode`.
- Keep the shell in `app.asar` and the complete backend production closure on the real filesystem under `resources/backend`.
- Produce only the NSIS installer for formal releases; remove the portable target and never publish `win-unpacked` or build diagnostics.
- Keep `workspace:^` source dependencies and upstream source synchronization; do not add a submodule or published-package runtime substitution.
- Record `https://github.com/deepseek-ai/deepseek-harness`, the synchronized official commit, source version, and desktop version in `apps/desktop/upstream.json`.
- Create the tray only after backend readiness and successful main-renderer load; close hides only when the tray exists, while explicit Quit and Restart to Update stop the backend before exit.
- Keep context isolation enabled, Node integration disabled, and renderer sandboxing enabled.
- Disable updates in development and when `DSH_DESKTOP_DISABLE_UPDATES=1`; use the fork's GitHub Releases and electron-builder metadata without `setFeedURL`.
- Rotate desktop logs at 10 MiB per file, delete files older than 7 days at startup, and cap retained logs at 200 MiB.
- Diagnostic export uses an allowlist and never includes credentials, environment variables, prompts, sessions, arbitrary user files, or post-readiness backend output.
- Pruning removes source maps, TypeScript build information, tests, examples, and non-Windows native artifacts only after inventory approval; it never globally deletes `.ts` files.
- Recovery records evidence and exposes actions, but never mutates or rolls back profiles, plugins, sessions, user data, or synchronized source.
- Keep code signing optional for local functional builds and required for a trusted public release; label unsigned output as a personal test build.
- Retain no autostart, task-completion notifications, marketplace, mobile remote, profile switching, or custom update service.
- The packaged unpacked size must be at least 50 MiB below 661,513,576 bytes and the installer at least 5 MiB below 173,809,836 bytes.
- Preserve the existing uncommitted desktop prototype and related root/Agent Note edits; never reset or overwrite unrelated user work, and stage exact paths in every commit.

---

## File Structure

- `apps/desktop/src/main/index.ts` becomes the composition root only; `desktop-app.ts` sequences startup and recovery.
- `backend.ts` owns spawn, the 90-second readiness deadline, typed exit reporting, and awaited two-phase shutdown; `url.ts` owns readiness parsing and exact loopback-origin checks.
- `runtime.ts` resolves development and packaged paths; `window.ts`, `menu.ts`, and `lifecycle.ts` own the immediate window, tray/application menus, close-to-hide, restore, and orderly exit.
- `logging.ts`, `health.ts`, and `diagnostics.ts` own bounded redacted evidence, active/last-healthy records, privacy confirmation, and allowlisted ZIP export.
- `updater.ts` wraps `electron-updater` in a testable state machine with no renderer privileges.
- `assets/loading.html` and `loading.css` form the local startup page; generated `build/` icon variants serve the executable, installer, shortcut target, window, loading page, and tray.
- `upstream.json` records official-source provenance; `footprint-baseline.json` records the measured prototype baseline.
- `prepare-backend.mjs`, `generate-notices.mjs`, `verify-upstream.mjs`, `generate-release-notes.mjs`, `verify-packaged-runtime.mjs`, `smoke-packaged-backend.mjs`, `measure-footprint.mjs`, and `verify-windows-icons.ps1` produce and verify the release.
- `.github/workflows/desktop-release.yml` validates, builds, signs when secrets exist, tests, packages, and publishes only the installer, `latest.yml`, and `.blockmap`.
- `apps/desktop/tests/*.spec.ts` cover focused modules through injected adapters; `tests/fixtures/*.mjs` exercise real child-process paths.
- The desktop README pair and the 2026-08-18 desktop Agent Note pair describe shipped behavior; the 2026-07-19 note pair keeps its cross-reference.

## Shared Interfaces

```typescript
export interface BackendExit {
  code: number | null
  signal: NodeJS.Signals | null
  requested: boolean
}

export interface BackendProcess {
  child: ChildProcess
  ready: Promise<string>
  done: Promise<BackendExit>
  stop(): Promise<BackendExit>
}

export interface RuntimePaths {
  node: string
  dshBin: string
  backendRoot: string
  loadingHtml: string
  icon: string
  trayLight: string
  trayDark: string
}

export type StartupStage = 'starting-service' | 'loading-interface' | 'ready' | 'failed'
export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'error'

export interface QuitCoordinator {
  isQuitting(): boolean
  requestQuit(reason: 'menu' | 'tray' | 'window' | 'session-end'): Promise<void>
  restartToUpdate(install: () => void): Promise<void>
}
```

### Task 1: Harden backend supervision and runtime provenance

**Files:**
- Modify: `apps/desktop/src/main/backend.ts`
- Modify: `apps/desktop/src/main/url.ts`
- Create: `apps/desktop/src/main/runtime.ts`
- Create: `apps/desktop/upstream.json`
- Create: `apps/desktop/footprint-baseline.json`
- Create: `apps/desktop/scripts/verify-upstream.mjs`
- Modify: `apps/desktop/tests/backend.spec.ts`
- Modify: `apps/desktop/tests/url.spec.ts`
- Create: `apps/desktop/tests/runtime.spec.ts`
- Create: `apps/desktop/tests/upstream.spec.ts`
- Create: `apps/desktop/tests/fixtures/backend-ready.mjs`
- Create: `apps/desktop/tests/fixtures/backend-hang.mjs`
- Create: `apps/desktop/tests/fixtures/backend-exit.mjs`

**Interfaces:**
- Consumes: Node `spawn`, `process.resourcesPath`, Electron's packaged flag, `createRequire`, desktop/source package versions, Git commit ancestry, and the measured release baseline.
- Produces: `startBackend(options: StartBackendOptions): BackendProcess`, `isAllowedAppNavigation(appUrl: string, target: string): boolean`, `resolveRuntimePaths(input: RuntimePathInput): RuntimePaths`, and the `verify-upstream.mjs` CLI accepting `--tag`, `--head`, and `--official-ref`.

- [ ] **Step 1: Add real-process and exact-origin tests**

```typescript
it('resolves once, reports the later exit, and awaits an orderly stop', async () => {
  const backend = startBackend({ node: process.execPath, bin: fixture('backend-ready.mjs'), port: 0, readinessTimeoutMs: 1_000, stopGraceMs: 1_000 })
  await expect(backend.ready).resolves.toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  const exit = await backend.stop()
  expect(exit.requested).toBe(true)
  await expect(backend.done).resolves.toEqual(exit)
})

it('rejects readiness after the configured deadline without settling twice', async () => {
  const backend = startBackend({ node: process.execPath, bin: fixture('backend-hang.mjs'), port: 0, readinessTimeoutMs: 50, stopGraceMs: 1_000 })
  await expect(backend.ready).rejects.toThrow('not ready within 50 ms')
  await backend.stop()
})

it('requires the exact backend origin', () => {
  expect(isAllowedAppNavigation('http://127.0.0.1:3080', 'http://127.0.0.1:3080/session/1')).toBe(true)
  expect(isAllowedAppNavigation('http://127.0.0.1:3080', 'http://127.0.0.1:3080.evil.test/')).toBe(false)
  expect(isAllowedAppNavigation('http://127.0.0.1:3080', 'https://example.com/')).toBe(false)
})
```

- [ ] **Step 2: Run focused tests and confirm the missing contracts fail**

Run: `pnpm exec vitest run apps/desktop/tests/backend.spec.ts apps/desktop/tests/url.spec.ts apps/desktop/tests/runtime.spec.ts apps/desktop/tests/upstream.spec.ts`

Expected: FAIL because readiness timeout, quiescent stop, runtime resolution, exact-origin checks, and upstream validation are absent.

- [ ] **Step 3: Implement one-shot readiness, independent completion, and awaited shutdown**

```typescript
export interface StartBackendOptions {
  node: string
  bin: string
  port: number
  env?: NodeJS.ProcessEnv
  readinessTimeoutMs?: number
  stopGraceMs?: number
  onStartupOutput?: (chunk: string) => void
}

export function startBackend(options: StartBackendOptions): BackendProcess {
  const child = spawn(options.node, [options.bin, 'web', '--port', String(options.port)], { env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const readiness = deferred<string>()
  const completion = deferred<BackendExit>()
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 90_000
  const stopGraceMs = options.stopGraceMs ?? 3_000
  let readySettled = false
  let stopRequested = false
  let stdout = ''
  const settleReady = (action: () => void): void => {
    if (readySettled) return
    readySettled = true
    clearTimeout(timer)
    action()
  }
  const timer = setTimeout(() => settleReady(() => readiness.reject(new Error(`dsh desktop backend was not ready within ${readinessTimeoutMs} ms`))), readinessTimeoutMs)
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
    if (!readySettled) options.onStartupOutput?.(chunk)
    const url = findWebUrl(stdout)
    if (url !== undefined) settleReady(() => readiness.resolve(url))
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { if (!readySettled) options.onStartupOutput?.(chunk) })
  child.once('error', (error) => settleReady(() => readiness.reject(error)))
  child.once('exit', (code, signal) => {
    const result = { code, signal, requested: stopRequested }
    settleReady(() => readiness.reject(new Error(`dsh desktop backend exited before readiness (${String(code)}, ${String(signal)})`)))
    completion.resolve(result)
  })
  const stop = async (): Promise<BackendExit> => {
    stopRequested = true
    if (child.exitCode !== null || child.signalCode !== null) return completion.promise
    child.kill('SIGTERM')
    const force = setTimeout(() => { child.kill('SIGKILL') }, stopGraceMs)
    try { return await completion.promise } finally { clearTimeout(force) }
  }
  return { child, ready: readiness.promise, done: completion.promise, stop }
}
```

- [ ] **Step 4: Add exact provenance and deterministic runtime resolution**

```json
{
  "repository": "https://github.com/deepseek-ai/deepseek-harness",
  "commit": "99f6f02fecdb7dff40c3fbc9470f5907c29f74ca",
  "sourceVersion": "0.1.0-rc.7",
  "desktopVersion": "0.1.0-rc.7"
}
```

```json
{
  "installerBytes": 173809836,
  "unpackedBytes": 661513576,
  "fileCount": 27251,
  "minimumInstallerReductionBytes": 5242880,
  "minimumUnpackedReductionBytes": 52428800
}
```

```typescript
export function isAllowedAppNavigation(appUrl: string, target: string): boolean {
  try { return new URL(target).origin === new URL(appUrl).origin } catch { return false }
}

export function resolveRuntimePaths(input: RuntimePathInput): RuntimePaths {
  const backendRoot = input.packaged ? join(input.resourcesPath, 'backend') : dirname(dirname(input.resolvePackageJson('@deepseek-ai/dsh/package.json')))
  const packageJson = input.resolvePackageJson('@deepseek-ai/dsh/package.json', backendRoot)
  const assetRoot = input.packaged ? input.appPath : join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  return {
    node: resolveBackendNode(input.env, input.packaged ? join(input.resourcesPath, 'node', 'node.exe') : undefined),
    dshBin: input.env.DSH_DESKTOP_DSH_BIN ?? join(dirname(packageJson), 'lib', 'bin.js'),
    backendRoot,
    loadingHtml: join(assetRoot, 'assets', 'loading.html'),
    icon: join(assetRoot, 'build', 'icon.png'),
    trayLight: join(assetRoot, 'build', 'tray-light.png'),
    trayDark: join(assetRoot, 'build', 'tray-dark.png'),
  }
}
```

- [ ] **Step 5: Implement fail-closed release validation and rerun verification**

```js
export function validateRelease({ tag, desktopPackage, sourcePackage, upstream, isAncestorOfHead, isAncestorOfOfficial }) {
  const version = tag.startsWith('desktop-v') ? tag.slice('desktop-v'.length) : ''
  const errors = []
  if (version !== desktopPackage.version) errors.push(`tag version ${version} does not match desktop version ${desktopPackage.version}`)
  if (upstream.desktopVersion !== desktopPackage.version) errors.push('upstream desktopVersion does not match apps/desktop/package.json')
  if (upstream.sourceVersion !== sourcePackage.version) errors.push('upstream sourceVersion does not match apps/cli/package.json')
  if (upstream.repository !== 'https://github.com/deepseek-ai/deepseek-harness') errors.push('upstream repository is not the official repository')
  if (!/^[0-9a-f]{40}$/.test(upstream.commit)) errors.push('upstream commit is not a full SHA-1')
  if (!isAncestorOfHead) errors.push('upstream commit is not an ancestor of the release commit')
  if (!isAncestorOfOfficial) errors.push('upstream commit is not an ancestor of official/master')
  return errors
}
```

Run: `pnpm exec vitest run apps/desktop/tests/backend.spec.ts apps/desktop/tests/url.spec.ts apps/desktop/tests/runtime.spec.ts apps/desktop/tests/upstream.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

Expected: all focused tests PASS and desktop compilation exits 0.

- [ ] **Step 6: Commit the backend and provenance foundation**

```bash
git add apps/desktop/src/main/backend.ts apps/desktop/src/main/url.ts apps/desktop/src/main/runtime.ts apps/desktop/upstream.json apps/desktop/footprint-baseline.json apps/desktop/scripts/verify-upstream.mjs apps/desktop/tests/backend.spec.ts apps/desktop/tests/url.spec.ts apps/desktop/tests/runtime.spec.ts apps/desktop/tests/upstream.spec.ts apps/desktop/tests/fixtures
git commit -m "feat(desktop): harden backend runtime provenance"
```

### Task 2: Add bounded diagnostics and launch-health evidence

**Files:**
- Create: `apps/desktop/src/main/logging.ts`
- Create: `apps/desktop/src/main/health.ts`
- Create: `apps/desktop/src/main/diagnostics.ts`
- Create: `apps/desktop/tests/logging.spec.ts`
- Create: `apps/desktop/tests/health.spec.ts`
- Create: `apps/desktop/tests/diagnostics.spec.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: user-data and Downloads paths, `StartupStage`, desktop/source/upstream versions, typed backend exits, native dialog adapters, and `archiver`.
- Produces: `createDesktopLogger(options): DesktopLogger`, `pruneLogs(options): PruneResult`, `beginRun(options): PriorRun | undefined`, `markRunHealthy(options): void`, `clearActiveRun(options): void`, `diagnosticEntries(options): DiagnosticEntry[]`, and `exportDiagnostics(options): Promise<string | undefined>`.

- [ ] **Step 1: Write failing tests for privacy, rotation, retention, health, and ZIP allowlisting**

```typescript
it('redacts credential-like values and rejects fields that can contain user content', () => {
  expect(redactText('Authorization: Bearer abc123 DEEPSEEK_API_KEY=secret')).not.toContain('abc123')
  expect(() => logger.info('unsafe', { prompt: 'private' })).toThrow('diagnostic field prompt is forbidden')
  expect(() => logger.info('unsafe', { session: 'private' })).toThrow('diagnostic field session is forbidden')
})

it('enforces 10 MiB files, seven-day retention, and a 200 MiB total cap', () => {
  const result = pruneLogs({ directory, now: new Date('2026-08-24T00:00:00Z'), maxAgeMs: 7 * 24 * 60 * 60 * 1_000, maxTotalBytes: 200 * 1024 * 1024 })
  expect(result.remainingBytes).toBeLessThanOrEqual(200 * 1024 * 1024)
  expect(result.files.every((file) => file.size <= 10 * 1024 * 1024)).toBe(true)
  expect(result.files.some((file) => file.name === 'eight-days-old.log')).toBe(false)
})

it('reports an unclean prior run and records then clears the current healthy run', () => {
  writeActiveRun(healthDirectory, priorRecord)
  expect(beginRun(currentRun)).toEqual(priorRecord)
  markRunHealthy(currentRun)
  expect(readLastHealthy(healthDirectory)).toMatchObject({ desktopVersion: currentRun.record.desktopVersion, upstreamCommit: currentRun.record.upstreamCommit })
  clearActiveRun(currentRun)
  expect(existsSync(activeRunPath(healthDirectory))).toBe(false)
})

it('exports only metadata, bounded desktop logs, active-run, and last-healthy files', () => {
  expect(diagnosticEntries(options).map((entry) => entry.archivePath)).toEqual([
    'metadata.json',
    'logs/desktop-2026-08-24T00-00-00-000Z.log',
    'health/active-run.json',
    'health/last-healthy.json',
  ])
})
```

- [ ] **Step 2: Run focused tests and confirm the modules are absent**

Run: `pnpm exec vitest run apps/desktop/tests/logging.spec.ts apps/desktop/tests/health.spec.ts apps/desktop/tests/diagnostics.spec.ts`

Expected: FAIL because the logging, health, and diagnostic exports do not exist.

- [ ] **Step 3: Implement strict JSONL logging and health records**

```typescript
const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024
const MAX_LOG_TOTAL_BYTES = 200 * 1024 * 1024
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const FORBIDDEN_FIELDS = new Set(['credential', 'credentials', 'environment', 'prompt', 'prompts', 'session', 'sessions', 'token', 'password', 'secret'])

export function assertDiagnosticFields(fields: Record<string, unknown>): void {
  for (const name of Object.keys(fields)) {
    if (FORBIDDEN_FIELDS.has(name.toLowerCase())) throw new Error(`diagnostic field ${name} is forbidden`)
  }
}

export function redactText(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/giu, '$1[REDACTED]')
    .replace(/([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s]+/giu, '$1[REDACTED]')
}

export function beginRun(options: HealthOptions): RunRecord | undefined {
  mkdirSync(options.directory, { recursive: true })
  const prior = readJsonIfPresent<RunRecord>(activeRunPath(options.directory))
  writeJsonAtomic(activeRunPath(options.directory), options.record)
  return prior
}

export function markRunHealthy(options: HealthOptions): void {
  const healthy = { ...options.record, stage: 'ready' as const, healthyAt: options.now().toISOString() }
  writeJsonAtomic(activeRunPath(options.directory), healthy)
  writeJsonAtomic(lastHealthyPath(options.directory), healthy)
}
```

- [ ] **Step 4: Implement native-confirmed allowlisted ZIP export**

```typescript
export function diagnosticEntries(options: DiagnosticOptions): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [{ kind: 'buffer', archivePath: 'metadata.json', data: Buffer.from(`${JSON.stringify(options.metadata, null, 2)}\n`) }]
  for (const file of options.logFiles) entries.push({ kind: 'file', archivePath: join('logs', basename(file)), sourcePath: file })
  if (existsSync(options.activeRunPath)) entries.push({ kind: 'file', archivePath: 'health/active-run.json', sourcePath: options.activeRunPath })
  if (existsSync(options.lastHealthyPath)) entries.push({ kind: 'file', archivePath: 'health/last-healthy.json', sourcePath: options.lastHealthyPath })
  return entries
}

export async function exportDiagnostics(options: ExportDiagnosticOptions): Promise<string | undefined> {
  const consent = await options.dialog.showMessageBox({
    type: 'warning',
    title: 'Export Diagnostics',
    message: 'The archive contains app versions, startup status, and desktop logs. It excludes credentials, prompts, sessions, and user files.',
    buttons: ['Export', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  if (consent.response !== 0) return undefined
  const destination = await options.dialog.showSaveDialog({ defaultPath: options.defaultPath, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] })
  if (destination.canceled || destination.filePath === undefined) return undefined
  await writeDiagnosticArchive(destination.filePath, diagnosticEntries(options.diagnostics), options.archiveFactory)
  return destination.filePath
}
```

- [ ] **Step 5: Add `archiver`, run focused tests, and compile**

Run: `pnpm --filter @deepseek-ai/dsh-desktop add archiver@8.0.0 && pnpm --filter @deepseek-ai/dsh-desktop add -D @types/archiver@8.0.0`

Run: `pnpm exec vitest run apps/desktop/tests/logging.spec.ts apps/desktop/tests/health.spec.ts apps/desktop/tests/diagnostics.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

Expected: focused tests PASS, forbidden fields are rejected, and compilation exits 0.

- [ ] **Step 6: Commit bounded diagnostics**

```bash
git add apps/desktop/src/main/logging.ts apps/desktop/src/main/health.ts apps/desktop/src/main/diagnostics.ts apps/desktop/tests/logging.spec.ts apps/desktop/tests/health.spec.ts apps/desktop/tests/diagnostics.spec.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add bounded diagnostics"
```

### Task 3: Build the immediate loading, tray, and orderly lifecycle

**Files:**
- Create: `apps/desktop/assets/loading.html`
- Create: `apps/desktop/assets/loading.css`
- Create: `apps/desktop/src/main/window.ts`
- Create: `apps/desktop/src/main/menu.ts`
- Create: `apps/desktop/src/main/lifecycle.ts`
- Create: `apps/desktop/src/main/desktop-app.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/tests/window.spec.ts`
- Create: `apps/desktop/tests/menu.spec.ts`
- Create: `apps/desktop/tests/lifecycle.spec.ts`
- Create: `apps/desktop/tests/desktop-app.spec.ts`

**Interfaces:**
- Consumes: `RuntimePaths`, `BackendProcess`, `DesktopLogger`, health and diagnostic operations, Electron window/tray/menu/dialog/shell adapters, and `QuitCoordinator`.
- Produces: `createMainWindow(options): DesktopWindow`, `createDesktopMenus(options): MenuResult`, `createQuitCoordinator(options): QuitCoordinator`, and `runDesktopApp(options): Promise<void>`.

- [ ] **Step 1: Write failing lifecycle tests covering every restore and exit path**

```typescript
it('shows loading immediately, loads the same window, then creates the tray', async () => {
  await runDesktopApp(harness.options)
  expect(harness.events).toEqual([
    'window:create',
    'window:load-loading:starting-service',
    'backend:start',
    'window:stage:loading-interface',
    'window:load-main:http://127.0.0.1:3080',
    'health:mark-ready',
    'tray:create',
    'updater:background-check',
  ])
})

it('hides on close only when a tray exists and keeps the backend alive', async () => {
  const result = handleWindowClose({ isQuitting: false, trayAvailable: true })
  expect(result).toBe('hide')
  expect(backend.stop).not.toHaveBeenCalled()
})

it('falls back to window exit when tray creation fails', async () => {
  trayFactory.mockImplementation(() => { throw new Error('tray unavailable') })
  await runDesktopApp(harness.options)
  expect(handleWindowClose({ isQuitting: false, trayAvailable: false })).toBe('quit')
  expect(applicationMenu.items).toContainEqual(expect.objectContaining({ label: 'Quit', accelerator: 'Ctrl+Q' }))
})

it('restores and focuses on tray left-click and second-instance', () => {
  restoreWindow(window)
  expect(window.restore).toHaveBeenCalled()
  expect(window.show).toHaveBeenCalled()
  expect(window.focus).toHaveBeenCalled()
  expect(tray.setToolTip).toHaveBeenCalledWith('DeepSeek Harness 0.1.0-rc.7')
})
```

- [ ] **Step 2: Run focused tests and confirm the lifecycle modules are absent**

Run: `pnpm exec vitest run apps/desktop/tests/window.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts`

Expected: FAIL because window, menu, lifecycle, and composition modules do not exist.

- [ ] **Step 3: Add the privilege-free loading page and secure same-window transition**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'">
    <title>DeepSeek Harness</title>
    <link rel="stylesheet" href="./loading.css">
  </head>
  <body>
    <main>
      <img src="../build/icon.png" alt="" width="72" height="72">
      <h1>DeepSeek Harness</h1>
      <p id="version"></p>
      <p id="status" aria-live="polite">Starting local service</p>
    </main>
  </body>
</html>
```

```typescript
export function createMainWindow(options: WindowOptions): DesktopWindow {
  const window = new options.BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    title: 'DeepSeek Harness',
    icon: options.paths.icon,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => { void options.openExternal(url); return { action: 'deny' } })
  return createDesktopWindowAdapter(window, options)
}
```

- [ ] **Step 4: Implement menus, close-to-hide, recovery, and quiescent quit**

```typescript
export function handleWindowClose(state: { isQuitting: boolean; trayAvailable: boolean }): 'close' | 'hide' | 'quit' {
  if (state.isQuitting) return 'close'
  return state.trayAvailable ? 'hide' : 'quit'
}

export function restoreWindow(window: RestorableWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function createQuitCoordinator(options: QuitOptions): QuitCoordinator {
  let quitting = false
  let quitPromise: Promise<void> | undefined
  const stop = async (): Promise<void> => {
    if (quitPromise !== undefined) return quitPromise
    quitting = true
    quitPromise = options.backend.stop().then(() => { options.clearActiveRun(); options.destroyTray(); options.appQuit() })
    return quitPromise
  }
  return {
    isQuitting: () => quitting,
    requestQuit: async () => stop(),
    restartToUpdate: async (install) => {
      quitting = true
      await options.backend.stop()
      options.clearActiveRun()
      options.destroyTray()
      install()
    },
  }
}
```

- [ ] **Step 5: Sequence real startup and recovery in `desktop-app.ts`**

```typescript
export async function runDesktopApp(options: DesktopAppOptions): Promise<void> {
  const window = options.createWindow()
  await window.loadLoading('starting-service', options.desktopVersion)
  for (;;) {
    const backend = options.startBackend()
    try {
      const url = await backend.ready
      await window.setStage('loading-interface')
      await window.loadMain(url)
      options.markHealthy()
      const tray = options.createMenus(window)
      options.bindLifecycle({ window, backend, tray })
      void options.checkForUpdatesInBackground()
      return
    } catch (error) {
      await backend.stop()
      await window.setStage('failed')
      const action = await options.showStartupRecovery(error)
      if (action === 'retry') { await window.setStage('starting-service'); continue }
      if (action === 'export-diagnostics') { await options.exportDiagnostics(); continue }
      if (action === 'open-logs') { await options.openLogs(); continue }
      await options.quitWithoutBackend()
      return
    }
  }
}
```

- [ ] **Step 6: Run lifecycle tests, compile, and commit**

Run: `pnpm exec vitest run apps/desktop/tests/window.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

Expected: all lifecycle tests PASS, including tray failure, second instance, `query-session-end`, update restart, and backend-exit recovery.

```bash
git add apps/desktop/assets/loading.html apps/desktop/assets/loading.css apps/desktop/src/main/window.ts apps/desktop/src/main/menu.ts apps/desktop/src/main/lifecycle.ts apps/desktop/src/main/desktop-app.ts apps/desktop/src/main/index.ts apps/desktop/tests/window.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts
git commit -m "feat(desktop): add tray startup lifecycle"
```

### Task 4: Add the installed-build update state machine

**Files:**
- Create: `apps/desktop/src/main/updater.ts`
- Create: `apps/desktop/tests/updater.spec.ts`
- Modify: `apps/desktop/src/main/menu.ts`
- Modify: `apps/desktop/src/main/desktop-app.ts`
- Modify: `apps/desktop/tests/menu.spec.ts`
- Modify: `apps/desktop/tests/desktop-app.spec.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: an `electron-updater` adapter, installed/development flags, `DSH_DESKTOP_DISABLE_UPDATES`, native dialogs, the main window taskbar adapter, logger, and `QuitCoordinator.restartToUpdate()`.
- Produces: `createUpdateManager(options): UpdateManager` with `state(): UpdateState`, `check(manual: boolean): Promise<void>`, `download(): Promise<void>`, and `restart(): Promise<void>`.

- [ ] **Step 1: Write failing tests for all update paths**

```typescript
it('disables updating outside installed production or through the explicit environment switch', () => {
  expect(createUpdateManager(options({ packaged: false })).state()).toBe('disabled')
  expect(createUpdateManager(options({ env: { DSH_DESKTOP_DISABLE_UPDATES: '1' } })).state()).toBe('disabled')
})

it('checks without auto-downloading and offers download, defer, then restart', async () => {
  const manager = createUpdateManager(options())
  await manager.check(true)
  updater.emit('update-available', { version: '0.1.0-rc.7.2' })
  expect(updater.autoDownload).toBe(false)
  expect(dialog.messages.at(-1)?.buttons).toEqual(['Download', 'Later'])
  await manager.download()
  updater.emit('download-progress', { percent: 42 })
  expect(window.setProgressBar).toHaveBeenLastCalledWith(0.42)
  updater.emit('update-downloaded', { version: '0.1.0-rc.7.2' })
  await manager.restart()
  expect(quitCoordinator.restartToUpdate).toHaveBeenCalledWith(expect.any(Function))
})

it('logs background network failure without interrupting the user and shows manual failure', async () => {
  await manager.check(false)
  updater.emit('error', new Error('offline'))
  expect(dialog.showMessageBox).not.toHaveBeenCalled()
  await manager.check(true)
  updater.emit('error', new Error('offline'))
  expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
})
```

- [ ] **Step 2: Run the update tests and confirm they fail**

Run: `pnpm exec vitest run apps/desktop/tests/updater.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/desktop-app.spec.ts`

Expected: FAIL because the update manager and menu command are absent.

- [ ] **Step 3: Implement explicit update states and event ownership**

```typescript
export interface UpdateManager {
  state(): UpdateState
  check(manual: boolean): Promise<void>
  download(): Promise<void>
  restart(): Promise<void>
}

export function createUpdateManager(options: UpdateOptions): UpdateManager {
  if (!options.packaged || options.env.DSH_DESKTOP_DISABLE_UPDATES === '1') return disabledUpdateManager()
  let state: UpdateState = 'idle'
  let manualCheck = false
  options.updater.autoDownload = false
  options.updater.autoInstallOnAppQuit = false
  options.updater.on('checking-for-update', () => { state = 'checking' })
  options.updater.on('update-available', (info) => { state = 'available'; void options.offerDownload(info.version) })
  options.updater.on('update-not-available', () => { state = 'current'; if (manualCheck) void options.showCurrentVersion() })
  options.updater.on('download-progress', ({ percent }) => { state = 'downloading'; options.window.setProgressBar(percent / 100) })
  options.updater.on('update-downloaded', (info) => { state = 'downloaded'; options.window.setProgressBar(-1); void options.offerRestart(info.version) })
  options.updater.on('error', (error) => { state = 'error'; options.window.setProgressBar(-1); options.logger.error('update-error', { message: redactText(error.message) }); if (manualCheck) void options.showManualError(error) })
  return {
    state: () => state,
    check: async (manual) => { manualCheck = manual; await options.updater.checkForUpdates() },
    download: async () => { state = 'downloading'; await options.updater.downloadUpdate() },
    restart: async () => options.quitCoordinator.restartToUpdate(() => options.updater.quitAndInstall(false, true)),
  }
}
```

- [ ] **Step 4: Add the maintained updater dependency and wire background/manual checks**

Run: `pnpm --filter @deepseek-ai/dsh-desktop add electron-updater@6.8.9`

```typescript
const updateManager = createUpdateManager({ packaged: app.isPackaged, env: process.env, updater: autoUpdater, dialog, window, logger, quitCoordinator })
const menuCommands = {
  show: () => restoreWindow(window),
  checkForUpdates: () => updateManager.check(true),
  exportDiagnostics: () => exportDiagnostics(diagnosticOptions),
  quit: () => quitCoordinator.requestQuit('menu'),
}
```

- [ ] **Step 5: Run update and lifecycle verification**

Run: `pnpm exec vitest run apps/desktop/tests/updater.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

Expected: all tests PASS; manual and background errors differ; restart stops the backend before `quitAndInstall`.

- [ ] **Step 6: Commit in-app updating**

```bash
git add apps/desktop/src/main/updater.ts apps/desktop/src/main/menu.ts apps/desktop/src/main/desktop-app.ts apps/desktop/tests/updater.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/desktop-app.spec.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add installed app updates"
```

### Task 5: Rebuild packaging, icons, runtime inventory, and footprint checks

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/scripts/make-icon.mjs`
- Modify: `apps/desktop/scripts/fetch-node.mjs`
- Create: `apps/desktop/scripts/prepare-backend.mjs`
- Create: `apps/desktop/scripts/generate-notices.mjs`
- Create: `apps/desktop/scripts/verify-packaged-runtime.mjs`
- Create: `apps/desktop/scripts/smoke-packaged-backend.mjs`
- Create: `apps/desktop/scripts/measure-footprint.mjs`
- Create: `apps/desktop/scripts/verify-windows-icons.ps1`
- Create: `apps/desktop/tests/packaging.spec.ts`
- Modify: `.gitignore`
- Modify: `knip.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `scripts/check-workspace-constraints.ts`

**Interfaces:**
- Consumes: the built root CLI/Web outputs, the desktop package's production dependency closure, Node 24.15.0 win-x64, icon SVG, electron-builder output, and `footprint-baseline.json`.
- Produces: `build/backend`, `build/node/node.exe`, generated icon variants, `THIRD_PARTY_NOTICES.txt`, one NSIS installer, update metadata, a packaged smoke result, and `release/footprint.json`.

- [ ] **Step 1: Write failing packaging tests for exact targets and assets**

```typescript
it('builds one NSIS target with ASAR and deployed backend resources', () => {
  expect(config.asar).toBe(true)
  expect(config.win.target).toEqual(['nsis'])
  expect(config.extraResources).toEqual(expect.arrayContaining([
    { from: 'build/backend', to: 'backend' },
    { from: 'build/node', to: 'node' },
  ]))
  expect(JSON.stringify(config)).not.toContain('portable')
})

it('keeps the shell ASAR free of a duplicated backend closure', async () => {
  const report = await inspectPackagedRuntime(fixtureApp)
  expect(report.asarEntries).toEqual(expect.arrayContaining(['/lib/main/index.cjs', '/assets/loading.html', '/build/icon.png']))
  expect(report.asarEntries.some((entry) => entry.startsWith('/node_modules/@deepseek-ai/'))).toBe(false)
  expect(report.backendEntries).toContain('node_modules/@deepseek-ai/dsh/lib/bin.js')
})
```

- [ ] **Step 2: Run packaging tests and confirm the current portable/unpacked design fails**

Run: `pnpm exec vitest run apps/desktop/tests/packaging.spec.ts`

Expected: FAIL because `asar` is false, portable is configured, runtime deployment and inventory scripts are absent, and tray icon variants do not exist.

- [ ] **Step 3: Bundle the thin main process and deploy the real backend closure**

```json
{
  "scripts": {
    "build": "tsdown src/main/index.ts --format cjs --platform node --external electron --out-dir lib/main --clean",
    "prepare-backend": "node scripts/prepare-backend.mjs",
    "dist": "pnpm run build && pnpm run fetch-node && pnpm run make-icon && pnpm run prepare-backend && electron-builder --publish never",
    "verify:package": "node scripts/verify-packaged-runtime.mjs",
    "smoke:package": "node scripts/smoke-packaged-backend.mjs",
    "footprint": "node scripts/measure-footprint.mjs"
  },
  "main": "lib/main/index.cjs"
}
```

```js
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '..', '..')
const target = resolve(desktopRoot, 'build', 'backend')
const allowedRoot = `${resolve(desktopRoot, 'build')}${sep}`
if (!`${target}${sep}`.startsWith(allowedRoot)) throw new Error(`refusing to replace backend outside ${allowedRoot}`)
removeKnownBuildDirectory(target)
execFileSync('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'deploy', '--prod', '--legacy', target], { cwd: repositoryRoot, stdio: 'inherit', shell: process.platform === 'win32' })
pruneSourceMapsBuildInfoTestsExamplesAndNonWindowsNativeArtifacts(target)
execFileSync(process.execPath, [join(desktopRoot, 'scripts', 'generate-notices.mjs'), target], { stdio: 'inherit' })
```

- [ ] **Step 4: Enable ASAR, NSIS-only output, update metadata, and all icon variants**

```yaml
appId: ai.deepseek.dsh.desktop
productName: DeepSeek Harness
directories:
  output: release
files:
  - lib/main/index.cjs
  - assets/loading.html
  - assets/loading.css
  - build/icon.png
  - build/tray-light.png
  - build/tray-dark.png
  - package.json
  - '!node_modules/**'
asar: true
npmRebuild: false
extraResources:
  - from: build/backend
    to: backend
  - from: build/node
    to: node
win:
  icon: build/icon.ico
  target:
    - nsis
publish:
  provider: github
  owner: ${env.DSH_DESKTOP_UPDATE_OWNER}
  repo: ${env.DSH_DESKTOP_UPDATE_REPO}
  tagNamePrefix: desktop-v
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
```

- [ ] **Step 5: Implement fail-closed packaged inventory and footprint checks**

```js
const required = [
  'resources/app.asar',
  'resources/app-update.yml',
  'resources/node/node.exe',
  'resources/backend/node_modules/@deepseek-ai/dsh/lib/bin.js',
  'resources/backend/THIRD_PARTY_NOTICES.txt',
]
for (const path of required) assertExists(join(unpackedDirectory, path))
assertNoUnexpectedPlatformNativeModules(join(unpackedDirectory, 'resources', 'backend'), ['win32-x64-msvc', 'win32-x64'])
assertAsarInventory(join(unpackedDirectory, 'resources', 'app.asar'), ['/lib/main/index.cjs', '/assets/loading.html', '/assets/loading.css', '/build/icon.png', '/build/tray-light.png', '/build/tray-dark.png'])
assertPublishManifest(publishManifest, [`DeepSeek Harness Setup ${version}.exe`, `DeepSeek Harness Setup ${version}.exe.blockmap`, 'latest.yml'])
```

Run: `pnpm run build && pnpm run desktop:dist && pnpm --filter @deepseek-ai/dsh-desktop run verify:package && pnpm --filter @deepseek-ai/dsh-desktop run smoke:package && pnpm --filter @deepseek-ai/dsh-desktop run footprint`

Expected: the shipped Node starts the shipped CLI, HTTP responds on the parsed loopback URL, the publish manifest contains only three formal assets while `win-unpacked` remains available for the smoke, unpacked bytes are at most 609,084,776, and installer bytes are at most 168,566,956.

- [ ] **Step 6: Inspect icons and commit packaging**

```powershell
param(
  [Parameter(Mandatory = $true)][string]$Unpacked,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Source
)
Add-Type -AssemblyName System.Drawing
function Get-NormalizedPixels([System.Drawing.Bitmap]$Bitmap) {
  $normalized = New-Object System.Drawing.Bitmap 64, 64
  $graphics = [System.Drawing.Graphics]::FromImage($normalized)
  try { $graphics.DrawImage($Bitmap, 0, 0, 64, 64) } finally { $graphics.Dispose(); $Bitmap.Dispose() }
  $bytes = New-Object System.Collections.Generic.List[byte]
  for ($y = 0; $y -lt 64; $y++) { for ($x = 0; $x -lt 64; $x++) { $pixel = $normalized.GetPixel($x, $y); $bytes.Add($pixel.A); $bytes.Add($pixel.R); $bytes.Add($pixel.G); $bytes.Add($pixel.B) } }
  $normalized.Dispose()
  return $bytes.ToArray()
}
function Get-MeanDifference([byte[]]$Left, [byte[]]$Right) {
  if ($Left.Length -ne $Right.Length) { throw 'normalized icon lengths differ' }
  [long]$sum = 0
  for ($index = 0; $index -lt $Left.Length; $index++) { $sum += [Math]::Abs([int]$Left[$index] - [int]$Right[$index]) }
  return $sum / $Left.Length
}
$sourcePixels = Get-NormalizedPixels ([System.Drawing.Bitmap]::FromFile((Resolve-Path $Source)))
foreach ($file in @((Join-Path $Unpacked 'DeepSeek Harness.exe'), $Installer)) {
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path $file))
  if ($null -eq $icon) { throw "missing associated icon: $file" }
  $difference = Get-MeanDifference $sourcePixels (Get-NormalizedPixels $icon.ToBitmap())
  $icon.Dispose()
  if ($difference -gt 12) { throw "associated icon differs from approved mark: $file ($difference)" }
}
```

Run: `powershell -NoProfile -File apps/desktop/scripts/verify-windows-icons.ps1 -Unpacked apps/desktop/release/win-unpacked -Installer "apps/desktop/release/DeepSeek Harness Setup 0.1.0-rc.7.exe" -Source apps/desktop/build/icon.png`

Expected: executable and installer associated icons match the generated 256 px mark; the shortcut target uses the same executable; window, loading, and tray asset tests PASS.

```bash
git add apps/desktop/package.json apps/desktop/electron-builder.yml apps/desktop/scripts apps/desktop/tests/packaging.spec.ts .gitignore knip.json package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/check-workspace-constraints.ts
git commit -m "build(desktop): package verified NSIS runtime"
```

### Task 6: Automate fork publishing, document the product, and prove upgrades

**Files:**
- Create: `.github/workflows/desktop-release.yml`
- Create: `apps/desktop/scripts/generate-release-notes.mjs`
- Modify: `apps/desktop/scripts/verify-upstream.mjs`
- Modify: `apps/desktop/tests/upstream.spec.ts`
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Modify: `apps/desktop/README.i18n.yaml`
- Modify: `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.md`
- Modify: `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.zh.md`
- Modify: `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.i18n.yaml`
- Modify: `.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`
- Modify: `.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.zh.md`
- Modify: `.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.i18n.yaml`

**Interfaces:**
- Consumes: authenticated GitHub CLI, a user fork, official `master`, `desktop-v<version>` tags, optional `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` secrets, and the three verified release assets.
- Produces: `origin` pointing to the user fork, `upstream` pointing to the official repository, a tag-triggered Windows workflow, a GitHub Release with exactly three assets, paired current-state documentation, and two-version installed-update evidence.

- [ ] **Step 1: Configure the fork remotes without changing source history**

```powershell
$account = gh api user --jq .login
gh repo fork deepseek-ai/deepseek-harness --clone=false --remote=false
git remote rename origin upstream
git remote add origin "https://github.com/$account/deepseek-harness.git"
git fetch upstream master --tags
git remote -v
```

Expected: fetch entries show `origin` at the authenticated account's fork and `upstream` at `https://github.com/deepseek-ai/deepseek-harness`; `git merge-base --is-ancestor 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca upstream/master` exits 0.

- [ ] **Step 2: Add a tag-gated release workflow**

```js
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const destination = resolve(process.argv[2])
const desktop = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const upstream = JSON.parse(readFileSync(new URL('../upstream.json', import.meta.url), 'utf8'))
const trust = process.env.CSC_LINK ? 'Windows code-signed release' : 'Unsigned personal test build'
const notes = [
  `Desktop version: ${desktop.version}`,
  `Source version: ${upstream.sourceVersion}`,
  `Official upstream: ${upstream.repository}`,
  `Upstream commit: ${upstream.commit}`,
  `Trust: ${trust}`,
  '',
].join('\n')
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, notes)
```

```yaml
name: Desktop Release
on:
  push:
    tags:
      - 'desktop-v*'
permissions:
  contents: write
jobs:
  windows-release:
    runs-on: windows-latest
    env:
      DSH_DESKTOP_UPDATE_OWNER: ${{ github.repository_owner }}
      DSH_DESKTOP_UPDATE_REPO: ${{ github.event.repository.name }}
      CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
      CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
      GH_TOKEN: ${{ github.token }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 11.7.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: git remote add official https://github.com/deepseek-ai/deepseek-harness.git
      - run: git fetch official master --no-tags
      - run: node apps/desktop/scripts/verify-upstream.mjs --tag $env:GITHUB_REF_NAME --head HEAD --official-ref official/master
      - run: pnpm run build
      - run: pnpm exec vitest run apps/desktop/tests
      - run: pnpm run desktop:dist
      - run: pnpm --filter @deepseek-ai/dsh-desktop run verify:package
      - run: pnpm --filter @deepseek-ai/dsh-desktop run smoke:package
      - run: pnpm --filter @deepseek-ai/dsh-desktop run footprint
      - run: node apps/desktop/scripts/generate-release-notes.mjs apps/desktop/release/release-notes.md
      - shell: pwsh
        run: |
          $version = (Get-Content apps/desktop/package.json | ConvertFrom-Json).version
          gh release create $env:GITHUB_REF_NAME --verify-tag --title "DeepSeek Harness Desktop $version" --notes-file apps/desktop/release/release-notes.md "apps/desktop/release/DeepSeek Harness Setup $version.exe" "apps/desktop/release/DeepSeek Harness Setup $version.exe.blockmap" "apps/desktop/release/latest.yml"
```

- [ ] **Step 3: Test release validation and release-asset rejection**

```typescript
it('accepts only installer, blockmap, and latest.yml for the same installer bytes', () => {
  const result = validateReleaseAssets(files, latestYaml)
  expect(result).toEqual({ installer: 'DeepSeek Harness Setup 0.1.0-rc.7.exe', blockmap: 'DeepSeek Harness Setup 0.1.0-rc.7.exe.blockmap', metadata: 'latest.yml' })
})

it.each(['DeepSeek Harness 0.1.0-rc.7.exe', 'win-unpacked', 'builder-debug.yml'])('rejects public artifact %s', (name) => {
  expect(() => validateReleaseAssets([...files, name], latestYaml)).toThrow(`unexpected release artifact: ${name}`)
})
```

Run: `pnpm exec vitest run apps/desktop/tests/upstream.spec.ts apps/desktop/tests/packaging.spec.ts`

Expected: validation tests PASS and mismatch cases fail closed.

- [ ] **Step 4: Update paired README and Agent Note current-state documentation**

Document these exact contracts in both languages: installed NSIS only; immediate same-window loading; tray close-to-hide and explicit Quit; GitHub Release updating; diagnostics contents and exclusions; real Node plus `resources/backend`; fork `origin` plus official `upstream`; tag format; signing caveat; package/smoke/footprint commands; no portable update path.

Run: `pnpm run verify-translation-pairing --write apps/desktop/README.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.md .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`

Expected: pairing records update and the command exits 0.

- [ ] **Step 5: Run the complete scoped verification before publishing**

Run: `pnpm exec vitest run apps/desktop/tests`

Run: `pnpm --filter @deepseek-ai/dsh-desktop run build`

Run: `pnpm run lint`

Run: `pnpm run hygiene`

Run: `pnpm run doc-sync`

Run: `git diff --check && git diff --cached --check`

Expected: every command exits 0; the diff has no `vendor/` path and no placeholder marker in the plan or implementation.

- [ ] **Step 6: Commit automation and documentation, then push the implementation**

```bash
git add .github/workflows/desktop-release.yml apps/desktop/README.md apps/desktop/README.zh.md apps/desktop/README.i18n.yaml apps/desktop/scripts/verify-upstream.mjs apps/desktop/tests/upstream.spec.ts .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.zh.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.i18n.yaml .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.zh.md .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.i18n.yaml
git commit -m "ci(desktop): automate installed releases"
git push -u origin master
```

- [ ] **Step 7: Publish and test two consecutive update versions**

Set the desktop package and `upstream.desktopVersion` first to `0.1.0-rc.7.1`, commit, tag `desktop-v0.1.0-rc.7.1`, and push the commit and tag. Install that version to a non-default D-drive directory, create a harmless setting and session, and record the installation path.

Set both desktop versions to `0.1.0-rc.7.2`, commit, tag `desktop-v0.1.0-rc.7.2`, and push the commit and tag. From the installed `.1` application, verify background discovery, manual check, Download, defer, network interruption, retry, Restart to Update, and no-update behavior. After restart, verify `.2`, the same D-drive installation path, setting, session, tray lifecycle, CLI/Web/terminal/file operations, and orderly backend shutdown.

Expected: each workflow is green; each GitHub Release has exactly three assets; `.1` updates to `.2` without local repackaging or user-data loss.

- [ ] **Step 8: Remove obsolete local portable outputs after the installed/update drill succeeds**

```powershell
$release = (Resolve-Path 'apps/desktop/release').Path
if ($release -ne 'D:\deepseek-harness\deepseek-harness\apps\desktop\release') { throw "unexpected release path: $release" }
Remove-Item -LiteralPath "$release\DeepSeek Harness 0.1.0-rc.7.exe" -Force
Remove-Item -LiteralPath "$release\builder-debug.yml" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$release\win-unpacked" -Recurse -Force
```

Expected: the obsolete portable executable and temporary unpacked test tree are removed; the verified NSIS installer and update metadata remain reproducible from the tag.

## Final Requirement Audit

- Immediate loading and same-window transition: Task 3 unit order plus installed smoke.
- Tray persistence, close-to-hide, restore, explicit quit, update restart, and tray-failure fallback: Task 3 lifecycle tests plus installed drill.
- Automatic/manual installed updates and safe failure/defer behavior: Task 4 state tests plus Task 6 two-version drill.
- Fork publishing and official upstream provenance: Tasks 1 and 6 validator tests, remote inspection, and workflow history.
- NSIS-only release and no portable artifact: Task 5 config/inventory tests and Task 6 Release asset inspection.
- Real Node and full backend closure: Task 5 inventory plus packaged backend HTTP smoke.
- Approved icon identity: Task 5 builder config, asset tests, and Windows icon extraction check.
- Diagnostics privacy, health, and retention: Task 2 unit tests plus a manually inspected exported ZIP.
- Size reduction: Task 5 `footprint.json` and threshold exit status.
- CLI, Web, terminal, file operations, settings, sessions, and custom installation location: Task 6 installed `.1` to `.2` acceptance record.
- Documentation and repository quality: Task 6 bilingual pairing, lint, hygiene, doc-sync, and diff checks.
