/** Measure release size and fail when the approved reduction is not achieved. */

import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseRoot = join(desktopRoot, 'release')
const unpacked = join(releaseRoot, 'win-unpacked')
const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const baseline = JSON.parse(readFileSync(join(desktopRoot, 'footprint-baseline.json'), 'utf8'))
const installer = join(releaseRoot, `DeepSeek Harness Setup ${pkg.version}.exe`)
if (!existsSync(unpacked) || !existsSync(installer)) throw new Error('measure-footprint: packaged output is missing')

function measure(path) {
  const stats = lstatSync(path)
  if (!stats.isDirectory()) return { bytes: stats.size, files: 1 }
  return readdirSync(path).reduce((total, name) => {
    const measured = measure(join(path, name))
    return { bytes: total.bytes + measured.bytes, files: total.files + measured.files }
  }, { bytes: 0, files: 0 })
}

const unpackedMeasure = measure(unpacked)
const installerBytes = lstatSync(installer).size
const maximumInstallerBytes = baseline.installerBytes - baseline.minimumInstallerReductionBytes
const maximumUnpackedBytes = baseline.unpackedBytes - baseline.minimumUnpackedReductionBytes
const largestDirectories = readdirSync(join(unpacked, 'resources'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => ({ name: entry.name, ...measure(join(unpacked, 'resources', entry.name)) }))
  .sort((left, right) => right.bytes - left.bytes)
const report = {
  installerBytes,
  unpackedBytes: unpackedMeasure.bytes,
  fileCount: unpackedMeasure.files,
  maximumInstallerBytes,
  maximumUnpackedBytes,
  installerReductionBytes: baseline.installerBytes - installerBytes,
  unpackedReductionBytes: baseline.unpackedBytes - unpackedMeasure.bytes,
  largestDirectories,
}
writeFileSync(join(desktopRoot, 'build', 'footprint.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (installerBytes > maximumInstallerBytes) {
  throw new Error(`measure-footprint: installer ${installerBytes} exceeds ${maximumInstallerBytes}`)
}
if (unpackedMeasure.bytes > maximumUnpackedBytes) {
  throw new Error(`measure-footprint: unpacked ${unpackedMeasure.bytes} exceeds ${maximumUnpackedBytes}`)
}
