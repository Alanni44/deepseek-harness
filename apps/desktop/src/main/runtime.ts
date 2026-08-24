/**
 * Development and packaged path resolution for the desktop shell and its
 * standard-Node backend deployment.
 * @module @deepseek-ai/dsh-desktop/runtime
 */

import { dirname, join } from 'node:path'
import { resolveBackendNode } from './backend.ts'

/** Paths consumed by the Electron shell and backend launcher. */
export interface RuntimePaths {
  /** Standard Node executable used by the backend. */
  node: string
  /** Built dsh CLI entry executed by standard Node. */
  dshBin: string
  /** Real-filesystem backend package root. */
  backendRoot: string
  /** Local startup page loaded before backend readiness. */
  loadingHtml: string
  /** Window and loading-page icon. */
  icon: string
  /** Tray image used for light system themes. */
  trayLight: string
  /** Tray image used for dark system themes. */
  trayDark: string
}

/** Inputs whose Electron-specific values are supplied by the composition root. */
export interface RuntimePathInput {
  /** Whether Electron is running an installed package. */
  packaged: boolean
  /** Electron `process.resourcesPath`. */
  resourcesPath: string
  /** Electron `app.getAppPath()`. */
  appPath: string
  /** Process environment containing supported desktop overrides. */
  env: NodeJS.ProcessEnv
  /** Resolve one package manifest from the selected dependency root. */
  resolvePackageJson: (specifier: string) => string
}

/**
 * Resolve all runtime paths without allowing standard Node to enter app.asar.
 * @param input - Electron paths, mode, environment, and package resolver.
 * @returns paths for the shell resources and backend process.
 */
export function resolveRuntimePaths(input: RuntimePathInput): RuntimePaths {
  const packageJson = input.resolvePackageJson('@deepseek-ai/dsh/package.json')
  const packageRoot = dirname(packageJson)
  const backendRoot = input.packaged ? join(input.resourcesPath, 'backend') : packageRoot
  return {
    node: resolveBackendNode(
      input.env,
      input.packaged ? join(input.resourcesPath, 'node', 'node.exe') : undefined,
    ),
    dshBin: input.env.DSH_DESKTOP_DSH_BIN ?? join(packageRoot, 'lib', 'bin.js'),
    backendRoot,
    loadingHtml: join(input.appPath, 'assets', 'loading.html'),
    icon: join(input.appPath, 'build', 'icon.png'),
    trayLight: join(input.appPath, 'build', 'tray-light.png'),
    trayDark: join(input.appPath, 'build', 'tray-dark.png'),
  }
}
