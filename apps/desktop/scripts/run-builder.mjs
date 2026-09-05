/** Clean only the known release directory and invoke electron-builder safely. */

import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = resolve(desktopRoot, 'release')
if (!`${releaseRoot}${sep}`.startsWith(`${desktopRoot}${sep}`) || releaseRoot === desktopRoot) {
  throw new Error(`run-builder: refusing to replace release output outside ${desktopRoot}`)
}
const npmExecPath = process.env.npm_execpath
if (npmExecPath === undefined) throw new Error('run-builder: npm_execpath is unavailable; run through pnpm')
const repository = process.env.GITHUB_REPOSITORY?.split('/')
const owner = process.env.DSH_DESKTOP_UPDATE_OWNER ?? repository?.[0] ?? 'local-build'
const repo = process.env.DSH_DESKTOP_UPDATE_REPO ?? repository?.[1] ?? 'deepseek-harness'
const githubSlug = /^[A-Za-z0-9_.-]+$/u
if (!githubSlug.test(owner) || !githubSlug.test(repo)) throw new Error('run-builder: invalid GitHub update owner or repository')

rmSync(releaseRoot, { recursive: true, force: true })
execFileSync(process.execPath, [npmExecPath, 'exec', 'electron-builder', '--publish', 'never'], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    DSH_DESKTOP_UPDATE_OWNER: owner,
    DSH_DESKTOP_UPDATE_REPO: repo,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_LINK === undefined ? 'false' : process.env.CSC_IDENTITY_AUTO_DISCOVERY,
  },
  stdio: 'inherit',
})
