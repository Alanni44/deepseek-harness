import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { resolveRuntimePaths } from '../src/main/runtime.ts'

describe('resolveRuntimePaths', () => {
  it('keeps the packaged backend and standard Node outside app.asar', () => {
    const resourcesPath = join('D:\\Apps', 'DeepSeek Harness', 'resources')
    const appPath = join(resourcesPath, 'app.asar')
    const packageJson = join(resourcesPath, 'backend', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')

    const paths = resolveRuntimePaths({
      packaged: true,
      resourcesPath,
      appPath,
      env: {},
      resolvePackageJson: (specifier) => {
        expect(specifier).toBe('@deepseek-ai/dsh/package.json')
        return packageJson
      },
    })

    expect(paths).toEqual({
      node: join(resourcesPath, 'node', 'node.exe'),
      dshBin: join(dirname(packageJson), 'lib', 'bin.js'),
      backendRoot: join(resourcesPath, 'backend'),
      loadingHtml: join(appPath, 'assets', 'loading.html'),
      icon: join(appPath, 'build', 'icon.png'),
      trayLight: join(appPath, 'build', 'tray-light.png'),
      trayDark: join(appPath, 'build', 'tray-dark.png'),
    })
  })

  it('uses workspace resolution and explicit development overrides', () => {
    const appPath = join('D:\\repo', 'apps', 'desktop')
    const packageJson = join('D:\\repo', 'apps', 'cli', 'package.json')
    const paths = resolveRuntimePaths({
      packaged: false,
      resourcesPath: join(appPath, 'unused-resources'),
      appPath,
      env: {
        DSH_DESKTOP_NODE: join('D:\\tools', 'node.exe'),
        DSH_DESKTOP_DSH_BIN: join('D:\\build', 'dsh-bin.js'),
      },
      resolvePackageJson: () => packageJson,
    })

    expect(paths.node).toBe(join('D:\\tools', 'node.exe'))
    expect(paths.dshBin).toBe(join('D:\\build', 'dsh-bin.js'))
    expect(paths.backendRoot).toBe(dirname(packageJson))
    expect(paths.loadingHtml).toBe(join(appPath, 'assets', 'loading.html'))
  })
})
