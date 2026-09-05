/** Deploy and narrowly prune the standard-Node backend production closure. */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '..', '..')
const buildRoot = resolve(desktopRoot, 'build')
const target = resolve(buildRoot, 'backend-runtime')
const expectedPrefix = `${buildRoot}${sep}`
if (!`${target}${sep}`.startsWith(expectedPrefix) || target === buildRoot) {
  throw new Error(`prepare-backend: refusing to replace backend outside ${buildRoot}`)
}

const npmExecPath = process.env.npm_execpath
if (npmExecPath === undefined) throw new Error('prepare-backend: npm_execpath is unavailable; run through pnpm')
const localSubprocessPackage = '@deepseek-ai/dsh-subprocess-local'
const localSubprocessSource = pathToFileURL(resolve(repositoryRoot, 'packages', 'subprocess', 'subprocess-local')).href
// `pnpm deploy` converts this workspace dependency into an absolute `file:` URL.
// pnpm reads the allow-list from the generated deployment workspace, so add that
// one precise key only while the deploy manifest is being generated. It is always
// restored afterwards; the checked-in policy stays portable across developer paths.
const workspaceConfigPath = join(repositoryRoot, 'pnpm-workspace.yaml')
const originalWorkspaceConfig = readFileSync(workspaceConfigPath, 'utf8')
const localSourceAllowlistKey = `  '${localSubprocessPackage}@file:packages/subprocess/subprocess-local': true`
const deployedSourceAllowlistKey = `  '${localSubprocessPackage}@${localSubprocessSource}': true`
if (!originalWorkspaceConfig.includes(localSourceAllowlistKey)) {
  throw new Error(`prepare-backend: expected allowBuilds entry is missing: ${localSourceAllowlistKey}`)
}
if (originalWorkspaceConfig.includes(deployedSourceAllowlistKey)) {
  throw new Error('prepare-backend: refusing to modify an already-expanded workspace allowBuilds entry')
}
const deploymentWorkspaceConfig = originalWorkspaceConfig.replace(
  localSourceAllowlistKey,
  `${localSourceAllowlistKey}\n${deployedSourceAllowlistKey}`,
)
rmSync(target, { recursive: true, force: true })
writeFileSync(workspaceConfigPath, deploymentWorkspaceConfig)
try {
  execFileSync(process.execPath, [
    npmExecPath,
    '--config.inject-workspace-packages=true',
    // The installer materializes this directory: isolated pnpm links would
    // otherwise resolve relative to the old virtual store after copying.
    '--config.node-linker=hoisted',
    '--config.verify-deps-before-run=false',
    '--filter',
    '@deepseek-ai/dsh-desktop',
    'deploy',
    target,
    '--prod',
  ], { cwd: repositoryRoot, stdio: 'inherit' })
} finally {
  writeFileSync(workspaceConfigPath, originalWorkspaceConfig)
}

function isInside(root, path) {
  const pathFromRoot = relative(root, path)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !pathFromRoot.startsWith(sep))
}

function verifySelfContainedLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const source = realpathSync(path)
      if (!isInside(target, source)) throw new Error(`prepare-backend: deploy contains external link ${path} -> ${source}`)
    } else if (entry.isDirectory()) {
      verifySelfContainedLinks(path)
    }
  }
}

verifySelfContainedLinks(target)

const removableDirectories = new Set(['__tests__', 'example', 'examples', 'test', 'tests'])
const foreignPlatformDirectory = /^(?:aix|android|darwin|freebsd|linux|openbsd|sunos)(?:[-_].*)?$/iu

function supportsCurrentWindows(manifest) {
  if (Array.isArray(manifest.os)) {
    const positive = manifest.os.filter(value => typeof value === 'string' && !value.startsWith('!'))
    if (manifest.os.includes('!win32') || (positive.length > 0 && !positive.includes('win32'))) return false
  }
  if (Array.isArray(manifest.cpu)) {
    const positive = manifest.cpu.filter(value => typeof value === 'string' && !value.startsWith('!'))
    if (manifest.cpu.includes('!x64') || (positive.length > 0 && !positive.includes('x64'))) return false
  }
  return true
}

function prune(directory) {
  const manifestPath = join(directory, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!supportsCurrentWindows(manifest)) {
      rmSync(directory, { recursive: true, force: true })
      return
    }
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (removableDirectories.has(entry.name.toLowerCase()) || foreignPlatformDirectory.test(entry.name)) {
        rmSync(path, { recursive: true, force: true })
      }
      else prune(path)
    } else if (entry.isFile() && (entry.name.endsWith('.map') || entry.name.endsWith('.tsbuildinfo'))) {
      rmSync(path, { force: true })
    }
  }
}

prune(target)
execFileSync(process.execPath, [join(desktopRoot, 'scripts', 'generate-notices.mjs'), target], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})
console.log(`prepare-backend: deployed ${relative(desktopRoot, target)}`)
