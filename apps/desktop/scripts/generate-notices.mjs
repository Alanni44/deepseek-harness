/** Generate a deterministic license inventory for one deployed backend. */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const backendRoot = resolve(process.argv[2] ?? '')
if (!existsSync(join(backendRoot, 'package.json'))) {
  throw new Error(`generate-notices: deployed backend package.json is missing under ${backendRoot}`)
}

const packages = new Map()

function visit(directory) {
  const manifestPath = join(directory, 'package.json')
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
        const license = typeof manifest.license === 'string'
          ? manifest.license
          : Array.isArray(manifest.licenses)
            ? manifest.licenses.map(entry => typeof entry === 'string' ? entry : entry?.type).filter(Boolean).join(' OR ')
            : 'SEE PACKAGE'
        packages.set(`${manifest.name}@${manifest.version}`, { name: manifest.name, version: manifest.version, license })
      }
    } catch (error) {
      throw new Error(`generate-notices: invalid ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    visit(join(directory, entry.name))
  }
}

visit(backendRoot)
const rows = [...packages.values()].sort((left, right) =>
  left.name.localeCompare(right.name) || left.version.localeCompare(right.version))
const output = [
  'DeepSeek Harness Desktop - Third-Party Notices',
  '================================================',
  '',
  'This file lists the production package closure deployed with the local backend.',
  'Each package remains subject to its own license and accompanying license files.',
  '',
  ...rows.map(entry => `${entry.name}@${entry.version}\t${entry.license}`),
  '',
].join('\n')
writeFileSync(join(backendRoot, 'THIRD_PARTY_NOTICES.txt'), output, 'utf8')
console.log(`generate-notices: recorded ${rows.length} deployed packages`)
