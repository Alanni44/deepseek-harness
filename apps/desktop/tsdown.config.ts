import { defineConfig } from 'tsdown'

/** Bundle the privileged shell and its two runtime libraries into one ASAR entry. */
export default defineConfig({
  entry: ['src/main/index.ts'],
  outDir: 'lib/main',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  fixedExtension: true,
  hash: false,
  dts: false,
  sourcemap: false,
  clean: true,
  shims: true,
  deps: {
    neverBundle: ['electron'],
    alwaysBundle: ['archiver', 'electron-updater'],
    onlyBundle: false,
  },
})
