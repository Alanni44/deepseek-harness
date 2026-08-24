# DeepSeek Harness 桌面端产品化实施计划

[English](2026-08-24-desktop-productization.md) | 中文

> **给智能体执行者：** 必须使用子技能 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐任务执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 将 Windows Electron 原型改造成只提供安装版的桌面产品，具备即时加载反馈、托盘常驻、应用内 GitHub Release 更新、可复现发布、经过验证的打包运行时，以及显著缩小的安装体积。

**架构：** Electron 继续作为位于 `app.asar` 中的轻量主进程外壳；它使用单独随包分发的标准 Node 可执行文件，运行构建后的 `dsh web` CLI，并从 `resources/backend` 中 pnpm 部署的生产依赖闭包解析模块。聚焦的主进程模块分别负责启动、生命周期、诊断、健康状态与更新；GitHub Actions 校验记录的官方上游基线，并从 `desktop-v<version>` 标签只发布 NSIS 更新产物。

**技术栈：** TypeScript 6、Electron 43、electron-builder 26、electron-updater 6、Vitest 4、pnpm 11、Node 24、NSIS、GitHub Actions、Windows PowerShell。

## 全局约束

- 保留独立的标准 Node 后端；绝不在 Electron 主进程、Electron 的 Node 运行时或 `runAsNode` 中运行后端。
- 外壳放入 `app.asar`，完整后端生产依赖闭包放在真实文件系统的 `resources/backend` 下。
- 正式发布只生成 NSIS 安装程序；移除 portable 目标，绝不发布 `win-unpacked` 或构建诊断文件。
- 保留 `workspace:^` 源码依赖和上游源码同步；不增加 submodule，也不使用已发布包替代运行时。
- 在 `apps/desktop/upstream.json` 中记录 `https://github.com/deepseek-ai/deepseek-harness`、同步的官方提交、源码版本和桌面端版本。
- 仅在后端就绪且主渲染器成功加载后创建托盘；只有托盘存在时关闭才隐藏，显式退出和重启更新必须先停止后端再退出。
- 保持上下文隔离开启、Node 集成关闭、渲染器沙箱开启。
- 开发模式以及 `DSH_DESKTOP_DISABLE_UPDATES=1` 时禁用更新；使用 fork 的 GitHub Releases 和 electron-builder 元数据，不调用 `setFeedURL`。
- 桌面日志每个文件达到 10 MiB 时轮转，启动时删除超过 7 天的文件，保留总量上限为 200 MiB。
- 诊断导出使用允许列表，绝不包含凭据、环境变量、提示词、会话、任意用户文件或后端就绪后的输出。
- 清理仅在清单批准后移除 source map、TypeScript 构建信息、测试、示例和非 Windows 原生产物；绝不全局删除 `.ts` 文件。
- 恢复流程记录证据并提供操作，但绝不修改或回滚 profile、插件、会话、用户数据或同步的源码。
- 本地功能构建可以不签名；可信公开发布必须签名；未签名产物标明为个人测试构建。
- 不增加开机自启、任务完成通知、市场、移动端远控、profile 切换或自建更新服务。
- 打包后的解包体积必须比 661,513,576 字节至少减少 50 MiB，安装程序必须比 173,809,836 字节至少减少 5 MiB。
- 保留现有未提交的桌面端原型以及相关根目录和 Agent Note 修改；绝不重置或覆盖无关用户工作，每次提交都精确暂存路径。

---

## 文件结构

- `apps/desktop/src/main/index.ts` 只作为组合入口；`desktop-app.ts` 编排启动与恢复。
- `backend.ts` 负责启动进程、90 秒就绪期限、类型化退出结果与可等待的两阶段停止；`url.ts` 负责就绪行解析和精确的回环 origin 校验。
- `runtime.ts` 解析开发与打包路径；`window.ts`、`menu.ts` 和 `lifecycle.ts` 负责即时窗口、托盘/应用菜单、关闭隐藏、恢复和有序退出。
- `logging.ts`、`health.ts` 和 `diagnostics.ts` 负责有界且脱敏的证据、当前/最近健康记录、隐私确认与允许列表 ZIP 导出。
- `updater.ts` 将 `electron-updater` 包装为可测试的状态机，不赋予渲染器权限。
- `assets/loading.html` 与 `loading.css` 构成本地启动页；生成在 `build/` 中的图标变体用于可执行文件、安装程序、快捷方式目标、窗口、启动页和托盘。
- `upstream.json` 记录官方源码来源；`footprint-baseline.json` 记录测得的原型基线。
- `prepare-backend.mjs`、`generate-notices.mjs`、`verify-upstream.mjs`、`generate-release-notes.mjs`、`verify-packaged-runtime.mjs`、`smoke-packaged-backend.mjs`、`measure-footprint.mjs` 和 `verify-windows-icons.ps1` 生成并校验发布。
- `.github/workflows/desktop-release.yml` 负责校验、构建、存在密钥时签名、测试、打包，并只发布安装程序、`latest.yml` 和 `.blockmap`。
- `apps/desktop/tests/*.spec.ts` 通过注入适配器覆盖聚焦模块；`tests/fixtures/*.mjs` 覆盖真实子进程路径。
- 桌面 README 配对和 2026-08-18 桌面 Agent Note 配对描述已交付行为；2026-07-19 Note 配对只保留其交叉链接。

## 共享接口

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

### 任务 1：强化后端监督与运行时来源记录

**文件：**
- 修改：`apps/desktop/src/main/backend.ts`
- 修改：`apps/desktop/src/main/url.ts`
- 新建：`apps/desktop/src/main/runtime.ts`
- 新建：`apps/desktop/upstream.json`
- 新建：`apps/desktop/footprint-baseline.json`
- 新建：`apps/desktop/scripts/verify-upstream.mjs`
- 修改：`apps/desktop/tests/backend.spec.ts`
- 修改：`apps/desktop/tests/url.spec.ts`
- 新建：`apps/desktop/tests/runtime.spec.ts`
- 新建：`apps/desktop/tests/upstream.spec.ts`
- 新建：`apps/desktop/tests/fixtures/backend-ready.mjs`
- 新建：`apps/desktop/tests/fixtures/backend-hang.mjs`
- 新建：`apps/desktop/tests/fixtures/backend-exit.mjs`

**接口：**
- 使用：Node `spawn`、`process.resourcesPath`、Electron 打包标记、`createRequire`、桌面/源码包版本、Git 提交祖先关系，以及测得的发布基线。
- 提供：`startBackend(options: StartBackendOptions): BackendProcess`、`isAllowedAppNavigation(appUrl: string, target: string): boolean`、`resolveRuntimePaths(input: RuntimePathInput): RuntimePaths`，以及接受 `--tag`、`--head` 和 `--official-ref` 的 `verify-upstream.mjs` CLI。

- [ ] **步骤 1：增加真实进程和精确 origin 测试**

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

- [ ] **步骤 2：运行聚焦测试，确认缺失契约会失败**

运行：`pnpm exec vitest run apps/desktop/tests/backend.spec.ts apps/desktop/tests/url.spec.ts apps/desktop/tests/runtime.spec.ts apps/desktop/tests/upstream.spec.ts`

预期：失败，因为尚无就绪超时、静止态停止、运行时解析、精确 origin 校验和上游校验。

- [ ] **步骤 3：实现一次性就绪、独立完成结果和可等待停止**

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

- [ ] **步骤 4：增加精确来源记录与确定性运行时解析**

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

- [ ] **步骤 5：实现失败关闭的发布校验并重新验证**

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

运行：`pnpm exec vitest run apps/desktop/tests/backend.spec.ts apps/desktop/tests/url.spec.ts apps/desktop/tests/runtime.spec.ts apps/desktop/tests/upstream.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

预期：所有聚焦测试通过，桌面端编译以 0 退出。

- [ ] **步骤 6：提交后端与来源记录基础**

```bash
git add apps/desktop/src/main/backend.ts apps/desktop/src/main/url.ts apps/desktop/src/main/runtime.ts apps/desktop/upstream.json apps/desktop/footprint-baseline.json apps/desktop/scripts/verify-upstream.mjs apps/desktop/tests/backend.spec.ts apps/desktop/tests/url.spec.ts apps/desktop/tests/runtime.spec.ts apps/desktop/tests/upstream.spec.ts apps/desktop/tests/fixtures
git commit -m "feat(desktop): harden backend runtime provenance"
```

### 任务 2：增加有界诊断与启动健康证据

**文件：**
- 新建：`apps/desktop/src/main/logging.ts`
- 新建：`apps/desktop/src/main/health.ts`
- 新建：`apps/desktop/src/main/diagnostics.ts`
- 新建：`apps/desktop/tests/logging.spec.ts`
- 新建：`apps/desktop/tests/health.spec.ts`
- 新建：`apps/desktop/tests/diagnostics.spec.ts`
- 修改：`apps/desktop/package.json`
- 修改：`pnpm-lock.yaml`

**接口：**
- 使用：用户数据与 Downloads 路径、`StartupStage`、桌面/源码/上游版本、类型化后端退出结果、原生对话框适配器以及 `archiver`。
- 提供：`createDesktopLogger(options): DesktopLogger`、`pruneLogs(options): PruneResult`、`beginRun(options): PriorRun | undefined`、`markRunHealthy(options): void`、`clearActiveRun(options): void`、`diagnosticEntries(options): DiagnosticEntry[]` 和 `exportDiagnostics(options): Promise<string | undefined>`。

- [ ] **步骤 1：编写隐私、轮转、保留、健康状态和 ZIP 允许列表的失败测试**

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

- [ ] **步骤 2：运行聚焦测试，确认模块尚不存在**

运行：`pnpm exec vitest run apps/desktop/tests/logging.spec.ts apps/desktop/tests/health.spec.ts apps/desktop/tests/diagnostics.spec.ts`

预期：失败，因为日志、健康状态和诊断导出尚不存在。

- [ ] **步骤 3：实现严格的 JSONL 日志与健康状态记录**

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

- [ ] **步骤 4：实现经原生确认的允许列表 ZIP 导出**

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

- [ ] **步骤 5：增加 `archiver`，运行聚焦测试并编译**

运行：`pnpm --filter @deepseek-ai/dsh-desktop add archiver@8.0.0 && pnpm --filter @deepseek-ai/dsh-desktop add -D @types/archiver@8.0.0`

运行：`pnpm exec vitest run apps/desktop/tests/logging.spec.ts apps/desktop/tests/health.spec.ts apps/desktop/tests/diagnostics.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

预期：聚焦测试通过，禁止字段被拒绝，编译以 0 退出。

- [ ] **步骤 6：提交有界诊断**

```bash
git add apps/desktop/src/main/logging.ts apps/desktop/src/main/health.ts apps/desktop/src/main/diagnostics.ts apps/desktop/tests/logging.spec.ts apps/desktop/tests/health.spec.ts apps/desktop/tests/diagnostics.spec.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add bounded diagnostics"
```

### 任务 3：构建即时加载、托盘与有序生命周期

**文件：**
- 新建：`apps/desktop/assets/loading.html`
- 新建：`apps/desktop/assets/loading.css`
- 新建：`apps/desktop/src/main/window.ts`
- 新建：`apps/desktop/src/main/menu.ts`
- 新建：`apps/desktop/src/main/lifecycle.ts`
- 新建：`apps/desktop/src/main/desktop-app.ts`
- 修改：`apps/desktop/src/main/index.ts`
- 新建：`apps/desktop/tests/window.spec.ts`
- 新建：`apps/desktop/tests/menu.spec.ts`
- 新建：`apps/desktop/tests/lifecycle.spec.ts`
- 新建：`apps/desktop/tests/desktop-app.spec.ts`

**接口：**
- 使用：`RuntimePaths`、`BackendProcess`、`DesktopLogger`、健康状态与诊断操作、Electron 窗口/托盘/菜单/对话框/shell 适配器，以及 `QuitCoordinator`。
- 提供：`createMainWindow(options): DesktopWindow`、`createDesktopMenus(options): MenuResult`、`createQuitCoordinator(options): QuitCoordinator` 和 `runDesktopApp(options): Promise<void>`。

- [ ] **步骤 1：编写覆盖全部恢复与退出路径的失败测试**

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

- [ ] **步骤 2：运行聚焦测试，确认生命周期模块尚不存在**

运行：`pnpm exec vitest run apps/desktop/tests/window.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts`

预期：失败，因为窗口、菜单、生命周期和组合模块尚不存在。

- [ ] **步骤 3：增加无权限启动页与安全的同窗口切换**

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

- [ ] **步骤 4：实现菜单、关闭隐藏、恢复与静止态退出**

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

- [ ] **步骤 5：在 `desktop-app.ts` 中编排真实启动与恢复**

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

- [ ] **步骤 6：运行生命周期测试、编译并提交**

运行：`pnpm exec vitest run apps/desktop/tests/window.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

预期：所有生命周期测试通过，包括托盘失败、第二实例、`query-session-end`、更新重启和后端退出恢复。

```bash
git add apps/desktop/assets/loading.html apps/desktop/assets/loading.css apps/desktop/src/main/window.ts apps/desktop/src/main/menu.ts apps/desktop/src/main/lifecycle.ts apps/desktop/src/main/desktop-app.ts apps/desktop/src/main/index.ts apps/desktop/tests/window.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts
git commit -m "feat(desktop): add tray startup lifecycle"
```

### 任务 4：增加安装版更新状态机

**文件：**
- 新建：`apps/desktop/src/main/updater.ts`
- 新建：`apps/desktop/tests/updater.spec.ts`
- 修改：`apps/desktop/src/main/menu.ts`
- 修改：`apps/desktop/src/main/desktop-app.ts`
- 修改：`apps/desktop/tests/menu.spec.ts`
- 修改：`apps/desktop/tests/desktop-app.spec.ts`
- 修改：`apps/desktop/package.json`
- 修改：`pnpm-lock.yaml`

**接口：**
- 使用：`electron-updater` 适配器、安装/开发标记、`DSH_DESKTOP_DISABLE_UPDATES`、原生对话框、主窗口任务栏适配器、日志记录器和 `QuitCoordinator.restartToUpdate()`。
- 提供：`createUpdateManager(options): UpdateManager`，包含 `state(): UpdateState`、`check(manual: boolean): Promise<void>`、`download(): Promise<void>` 和 `restart(): Promise<void>`。

- [ ] **步骤 1：编写覆盖全部更新路径的失败测试**

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

- [ ] **步骤 2：运行更新测试，确认其失败**

运行：`pnpm exec vitest run apps/desktop/tests/updater.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/desktop-app.spec.ts`

预期：失败，因为更新管理器和菜单命令尚不存在。

- [ ] **步骤 3：实现显式更新状态与事件所有权**

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

- [ ] **步骤 4：增加维护良好的 updater 依赖并连接后台/手动检查**

运行：`pnpm --filter @deepseek-ai/dsh-desktop add electron-updater@6.8.9`

```typescript
const updateManager = createUpdateManager({ packaged: app.isPackaged, env: process.env, updater: autoUpdater, dialog, window, logger, quitCoordinator })
const menuCommands = {
  show: () => restoreWindow(window),
  checkForUpdates: () => updateManager.check(true),
  exportDiagnostics: () => exportDiagnostics(diagnosticOptions),
  quit: () => quitCoordinator.requestQuit('menu'),
}
```

- [ ] **步骤 5：运行更新与生命周期验证**

运行：`pnpm exec vitest run apps/desktop/tests/updater.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/lifecycle.spec.ts apps/desktop/tests/desktop-app.spec.ts && pnpm --filter @deepseek-ai/dsh-desktop run build`

预期：所有测试通过；手动与后台错误行为不同；重启更新先停止后端再调用 `quitAndInstall`。

- [ ] **步骤 6：提交应用内更新**

```bash
git add apps/desktop/src/main/updater.ts apps/desktop/src/main/menu.ts apps/desktop/src/main/desktop-app.ts apps/desktop/tests/updater.spec.ts apps/desktop/tests/menu.spec.ts apps/desktop/tests/desktop-app.spec.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add installed app updates"
```

### 任务 5：重建打包、图标、运行时清单与体积检查

**文件：**
- 修改：`apps/desktop/package.json`
- 修改：`apps/desktop/electron-builder.yml`
- 修改：`apps/desktop/scripts/make-icon.mjs`
- 修改：`apps/desktop/scripts/fetch-node.mjs`
- 新建：`apps/desktop/scripts/prepare-backend.mjs`
- 新建：`apps/desktop/scripts/generate-notices.mjs`
- 新建：`apps/desktop/scripts/verify-packaged-runtime.mjs`
- 新建：`apps/desktop/scripts/smoke-packaged-backend.mjs`
- 新建：`apps/desktop/scripts/measure-footprint.mjs`
- 新建：`apps/desktop/scripts/verify-windows-icons.ps1`
- 新建：`apps/desktop/tests/packaging.spec.ts`
- 修改：`.gitignore`
- 修改：`knip.json`
- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 修改：`pnpm-workspace.yaml`
- 修改：`scripts/check-workspace-constraints.ts`

**接口：**
- 使用：构建后的根 CLI/Web 产物、桌面包的生产依赖闭包、Node 24.15.0 win-x64、图标 SVG、electron-builder 输出和 `footprint-baseline.json`。
- 提供：`build/backend`、`build/node/node.exe`、生成的图标变体、`THIRD_PARTY_NOTICES.txt`、一个 NSIS 安装程序、更新元数据、打包烟雾结果和 `release/footprint.json`。

- [ ] **步骤 1：编写精确目标与资源的失败打包测试**

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

- [ ] **步骤 2：运行打包测试，确认当前 portable/解包设计失败**

运行：`pnpm exec vitest run apps/desktop/tests/packaging.spec.ts`

预期：失败，因为 `asar` 为 false、配置了 portable、尚无运行时部署与清单脚本，也没有托盘图标变体。

- [ ] **步骤 3：捆绑轻量主进程并部署真实后端闭包**

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

- [ ] **步骤 4：启用 ASAR、仅 NSIS 输出、更新元数据和全部图标变体**

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

- [ ] **步骤 5：实现失败关闭的打包清单与体积检查**

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

运行：`pnpm run build && pnpm run desktop:dist && pnpm --filter @deepseek-ai/dsh-desktop run verify:package && pnpm --filter @deepseek-ai/dsh-desktop run smoke:package && pnpm --filter @deepseek-ai/dsh-desktop run footprint`

预期：随包 Node 启动随包 CLI，解析出的回环 URL 可正常响应 HTTP；发布清单只包含三个正式资源，同时保留 `win-unpacked` 供烟雾测试使用；解包体积最多为 609,084,776 字节，安装程序最多为 168,566,956 字节。

- [ ] **步骤 6：检查图标并提交打包改动**

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

运行：`powershell -NoProfile -File apps/desktop/scripts/verify-windows-icons.ps1 -Unpacked apps/desktop/release/win-unpacked -Installer "apps/desktop/release/DeepSeek Harness Setup 0.1.0-rc.7.exe" -Source apps/desktop/build/icon.png`

预期：可执行文件与安装程序的关联图标和生成的 256 px 标志一致；快捷方式目标使用同一个可执行文件；窗口、启动页和托盘资源测试通过。

```bash
git add apps/desktop/package.json apps/desktop/electron-builder.yml apps/desktop/scripts apps/desktop/tests/packaging.spec.ts .gitignore knip.json package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/check-workspace-constraints.ts
git commit -m "build(desktop): package verified NSIS runtime"
```

### 任务 6：自动化 fork 发布、记录产品并证明升级

**文件：**
- 新建：`.github/workflows/desktop-release.yml`
- 新建：`apps/desktop/scripts/generate-release-notes.mjs`
- 修改：`apps/desktop/scripts/verify-upstream.mjs`
- 修改：`apps/desktop/tests/upstream.spec.ts`
- 修改：`apps/desktop/README.md`
- 修改：`apps/desktop/README.zh.md`
- 修改：`apps/desktop/README.i18n.yaml`
- 修改：`.agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.md`
- 修改：`.agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.zh.md`
- 修改：`.agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.i18n.yaml`
- 修改：`.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`
- 修改：`.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.zh.md`
- 修改：`.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.i18n.yaml`

**接口：**
- 使用：已认证 GitHub CLI、用户 fork、官方 `master`、`desktop-v<version>` 标签、可选的 `WIN_CSC_LINK` 与 `WIN_CSC_KEY_PASSWORD` secrets，以及三个已验证发布产物。
- 提供：指向用户 fork 的 `origin`、指向官方仓库的 `upstream`、标签触发的 Windows 工作流、恰好含三个资源的 GitHub Release、配对的当前状态文档，以及两个版本的安装更新证据。

- [ ] **步骤 1：配置 fork remotes，不改变源码历史**

```powershell
$account = gh api user --jq .login
gh repo fork deepseek-ai/deepseek-harness --clone=false --remote=false
git remote rename origin upstream
git remote add origin "https://github.com/$account/deepseek-harness.git"
git fetch upstream master --tags
git remote -v
```

预期：fetch 条目显示 `origin` 指向已认证账号的 fork，`upstream` 指向 `https://github.com/deepseek-ai/deepseek-harness`；`git merge-base --is-ancestor 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca upstream/master` 以 0 退出。

- [ ] **步骤 2：增加标签门控发布工作流**

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

- [ ] **步骤 3：测试发布校验与发布资源拒绝规则**

```typescript
it('accepts only installer, blockmap, and latest.yml for the same installer bytes', () => {
  const result = validateReleaseAssets(files, latestYaml)
  expect(result).toEqual({ installer: 'DeepSeek Harness Setup 0.1.0-rc.7.exe', blockmap: 'DeepSeek Harness Setup 0.1.0-rc.7.exe.blockmap', metadata: 'latest.yml' })
})

it.each(['DeepSeek Harness 0.1.0-rc.7.exe', 'win-unpacked', 'builder-debug.yml'])('rejects public artifact %s', (name) => {
  expect(() => validateReleaseAssets([...files, name], latestYaml)).toThrow(`unexpected release artifact: ${name}`)
})
```

运行：`pnpm exec vitest run apps/desktop/tests/upstream.spec.ts apps/desktop/tests/packaging.spec.ts`

预期：校验测试通过，不一致情况失败关闭。

- [ ] **步骤 4：更新配对 README 与 Agent Note 当前状态文档**

两种语言都记录这些精确契约：只提供已安装 NSIS；即时同窗口加载；托盘关闭隐藏和显式退出；GitHub Release 更新；诊断内容与排除项；真实 Node 加 `resources/backend`；fork `origin` 加官方 `upstream`；标签格式；签名限制；打包/烟雾/体积命令；没有 portable 更新路径。

运行：`pnpm run verify-translation-pairing --write apps/desktop/README.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.md .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`

预期：配对记录更新，命令以 0 退出。

- [ ] **步骤 5：发布前运行完整的范围内验证**

运行：`pnpm exec vitest run apps/desktop/tests`

运行：`pnpm --filter @deepseek-ai/dsh-desktop run build`

运行：`pnpm run lint`

运行：`pnpm run hygiene`

运行：`pnpm run doc-sync`

运行：`git diff --check && git diff --cached --check`

预期：每个命令都以 0 退出；diff 不含 `vendor/` 路径，计划或实现中没有占位标记。

- [ ] **步骤 6：提交自动化与文档，然后推送实现**

```bash
git add .github/workflows/desktop-release.yml apps/desktop/README.md apps/desktop/README.zh.md apps/desktop/README.i18n.yaml apps/desktop/scripts/verify-upstream.mjs apps/desktop/tests/upstream.spec.ts .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.zh.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-spawns-web-backend.i18n.yaml .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.zh.md .agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.i18n.yaml
git commit -m "ci(desktop): automate installed releases"
git push -u origin master
```

- [ ] **步骤 7：发布并测试两个连续更新版本**

先将桌面包与 `upstream.desktopVersion` 设为 `0.1.0-rc.7.1`，提交，创建 `desktop-v0.1.0-rc.7.1` 标签，并推送提交与标签。将该版本安装到 D 盘的非默认目录，创建无害设置和会话，并记录安装路径。

再将两个桌面版本设为 `0.1.0-rc.7.2`，提交，创建 `desktop-v0.1.0-rc.7.2` 标签，并推送提交与标签。在已安装的 `.1` 应用中验证后台发现、手动检查、下载、延后、网络中断、重试、重启更新和无更新行为。重启后验证 `.2`、相同的 D 盘安装路径、设置、会话、托盘生命周期、CLI/Web/终端/文件操作，以及有序后端停止。

预期：两个工作流都为绿色；每个 GitHub Release 恰好包含三个资源；`.1` 无需本地重新打包且不丢失用户数据即可升级到 `.2`。

- [ ] **步骤 8：安装/更新演练成功后删除过时的本地 portable 输出**

```powershell
$release = (Resolve-Path 'apps/desktop/release').Path
if ($release -ne 'D:\deepseek-harness\deepseek-harness\apps\desktop\release') { throw "unexpected release path: $release" }
Remove-Item -LiteralPath "$release\DeepSeek Harness 0.1.0-rc.7.exe" -Force
Remove-Item -LiteralPath "$release\builder-debug.yml" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$release\win-unpacked" -Recurse -Force
```

预期：过时的 portable 可执行文件与临时解包测试目录已删除；经过验证的 NSIS 安装程序与更新元数据仍可由标签复现。

## 最终需求审计

- 即时加载与同窗口切换：任务 3 单元顺序与安装烟雾测试。
- 托盘常驻、关闭隐藏、恢复、显式退出、更新重启及托盘失败降级：任务 3 生命周期测试与安装演练。
- 自动/手动安装版更新及安全的失败/延后行为：任务 4 状态测试与任务 6 双版本演练。
- fork 发布与官方上游来源：任务 1 和 6 的校验器测试、remote 检查与工作流历史。
- 仅 NSIS 发布且无 portable 产物：任务 5 配置/清单测试与任务 6 Release 资源检查。
- 真实 Node 与完整后端闭包：任务 5 清单与打包后端 HTTP 烟雾测试。
- 经批准的图标身份：任务 5 builder 配置、资源测试和 Windows 图标提取检查。
- 诊断隐私、健康状态与保留：任务 2 单元测试与人工检查导出 ZIP。
- 体积缩减：任务 5 `footprint.json` 与阈值退出状态。
- CLI、Web、终端、文件操作、设置、会话与自定义安装位置：任务 6 从 `.1` 到 `.2` 的安装验收记录。
- 文档与仓库质量：任务 6 双语配对、lint、hygiene、doc-sync 和 diff 检查。
