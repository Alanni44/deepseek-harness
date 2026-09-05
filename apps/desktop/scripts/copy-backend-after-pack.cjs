/** Materialize the deployed pnpm backend after Electron Builder filters app files. */

const { cpSync, existsSync, lstatSync, readdirSync, rmSync } = require('node:fs')
const { join, resolve, sep } = require('node:path')

const desktopRoot = resolve(__dirname, '..')
const backendSource = resolve(desktopRoot, 'build', 'backend-runtime')
const removableDirectories = new Set(['__tests__', 'example', 'examples', 'test', 'tests'])
const foreignPlatformDirectory = /^(?:aix|android|darwin|freebsd|linux|openbsd|sunos)(?:[-_].*)?$/iu

function pruneMaterializedBackend(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (removableDirectories.has(entry.name.toLowerCase()) || foreignPlatformDirectory.test(entry.name)) {
        rmSync(path, { recursive: true, force: true })
      } else {
        pruneMaterializedBackend(path)
      }
    } else if (entry.isFile() && (entry.name.endsWith('.map') || entry.name.endsWith('.tsbuildinfo'))) {
      rmSync(path, { force: true })
    }
  }
}

module.exports = function copyBackendAfterPack(context) {
  const appOutDir = resolve(context.appOutDir)
  const resourcesRoot = resolve(appOutDir, 'resources')
  const backendDestination = resolve(resourcesRoot, 'backend')
  if (!`${resourcesRoot}${sep}`.startsWith(`${appOutDir}${sep}`)) {
    throw new Error(`copy-backend-after-pack: invalid resources directory ${resourcesRoot}`)
  }
  if (!`${backendDestination}${sep}`.startsWith(`${resourcesRoot}${sep}`)) {
    throw new Error(`copy-backend-after-pack: refusing destination outside resources ${backendDestination}`)
  }
  if (!existsSync(backendSource) || !lstatSync(backendSource).isDirectory()) {
    throw new Error(`copy-backend-after-pack: missing prepared backend ${backendSource}`)
  }
  if (existsSync(backendDestination)) rmSync(backendDestination, { recursive: true, force: true })
  cpSync(backendSource, backendDestination, { recursive: true, dereference: true, preserveTimestamps: true })
  pruneMaterializedBackend(backendDestination)
}
