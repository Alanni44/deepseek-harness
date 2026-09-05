/** Write the concise provenance and signing status used by one GitHub Release. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = process.argv[2]
if (destination === undefined) throw new Error('generate-release-notes: provide the output path')

const desktop = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'))
const upstream = JSON.parse(readFileSync(resolve(desktopRoot, 'upstream.json'), 'utf8'))
const trust = process.env.CSC_LINK ? 'Windows code-signed release' : 'Unsigned personal test build'
const notes = [
  `Desktop version: ${desktop.version}`,
  `Source version: ${upstream.sourceVersion}`,
  `Official upstream: ${upstream.repository}`,
  `Upstream commit: ${upstream.commit}`,
  `Trust: ${trust}`,
  '',
].join('\n')

const output = resolve(destination)
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, notes)
console.log(`generate-release-notes: wrote ${output}`)
