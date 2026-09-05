import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const smoke = readFileSync(join(desktopRoot, 'scripts', 'smoke-packaged-backend.mjs'), 'utf8')
const footprint = readFileSync(join(desktopRoot, 'scripts', 'measure-footprint.mjs'), 'utf8')

assert.match(pkg.scripts.dist, /verify:package/u)
assert.match(pkg.scripts.dist, /smoke:package/u)
assert.match(pkg.scripts.dist, /footprint/u)
assert.match(pkg.scripts.dist, /finalize-release\.mjs/u)
assert.match(smoke, /join\(desktopRoot, 'build', 'smoke-packaged-backend\.json'\)/u)
assert.match(footprint, /join\(desktopRoot, 'build', 'footprint\.json'\)/u)
