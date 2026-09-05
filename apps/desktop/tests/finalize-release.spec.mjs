import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { finalizeRelease } from '../scripts/finalize-release.mjs'

const release = mkdtempSync(join(tmpdir(), 'dsh-desktop-release-'))
const installer = 'DeepSeek Harness Setup 0.1.0-rc.7.exe'
try {
  for (const name of [installer, `${installer}.blockmap`, 'latest.yml', 'builder-debug.yml', 'footprint.json', 'smoke-packaged-backend.json', 'DeepSeek Harness 0.1.0-rc.7.exe']) {
    writeFileSync(join(release, name), name)
  }
  mkdirSync(join(release, 'win-unpacked'))

  finalizeRelease({ releaseRoot: release, installerName: installer })

  assert.deepEqual(readdirSync(release).sort(), [installer, `${installer}.blockmap`, 'latest.yml'].sort())
} finally {
  rmSync(release, { recursive: true, force: true })
}
