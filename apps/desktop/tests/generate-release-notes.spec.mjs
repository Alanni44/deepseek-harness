import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const desktopRoot = resolve(import.meta.dirname, '..')
const script = join(desktopRoot, 'scripts', 'generate-release-notes.mjs')
const desktop = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const upstream = JSON.parse(readFileSync(join(desktopRoot, 'upstream.json'), 'utf8'))
const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-release-notes-'))
const destination = join(directory, 'release-notes.md')

try {
  const result = spawnSync(process.execPath, [script, destination], {
    encoding: 'utf8',
    env: { ...process.env, CSC_LINK: '' },
  })
  assert.equal(result.status, 0, result.stderr)
  const notes = readFileSync(destination, 'utf8')
  assert.match(notes, new RegExp(`^Desktop version: ${desktop.version}$`, 'mu'))
  assert.match(notes, new RegExp(`^Source version: ${upstream.sourceVersion}$`, 'mu'))
  assert.match(notes, new RegExp(`^Official upstream: ${upstream.repository.replaceAll('/', '\\/')}$`, 'mu'))
  assert.match(notes, /^Trust: Unsigned personal test build$/mu)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
