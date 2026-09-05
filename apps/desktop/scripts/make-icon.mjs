/**
 * Render the DeepSeek Harness mark (assets/icon.svg, the same mark as the web
 * favicon) into a multi-size Windows ICO plus a 256px PNG. The PNG is the
 * BrowserWindow and loading icon for source-mode runs; the ICO is embedded in
 * the installed executable and NSIS installer. Two compact PNGs serve the tray.
 *
 * Usage: `node scripts/make-icon.mjs` (run by the `dist` script before
 * electron-builder).
 * @module @deepseek-ai/dsh-desktop/make-icon
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** ICO sizes; 256 is encoded with a 0 byte per the ICO spec. */
const SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Assemble a multi-image ICO whose entries are PNG payloads (Vista+). */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const directories = []
  const payloads = []
  let offset = 6 + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size === 256 ? 0 : size, 0) // width, 0 means 256
    entry.writeUInt8(size === 256 ? 0 : size, 1) // height, 0 means 256
    entry.writeUInt8(0, 2) // color count (0 for PNG entries)
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8) // payload byte length
    entry.writeUInt32LE(offset, 12) // payload offset
    directories.push(entry)
    payloads.push(png)
    offset += png.length
  }
  return Buffer.concat([header, ...directories, ...payloads])
}

async function main() {
  const svg = readFileSync(join(ROOT, 'assets', 'icon.svg'))
  // The mark's viewBox is 50x50; density scales it so 256px is rendered natively,
  // and every smaller size is a clean downscale.
  const master = await sharp(svg, { density: 256 / 50 * 72 }).resize(256, 256).png().toBuffer()
  const images = []
  for (const size of SIZES) {
    const png = size === 256 ? master : await sharp(master).resize(size, size).png().toBuffer()
    images.push({ size, png })
  }
  const outDir = join(ROOT, 'build')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'icon.ico'), buildIco(images))
  writeFileSync(join(outDir, 'icon.png'), master)
  const tray = await sharp(master).resize(32, 32).png().toBuffer()
  writeFileSync(join(outDir, 'tray-light.png'), tray)
  writeFileSync(join(outDir, 'tray-dark.png'), tray)
  console.log(`make-icon: wrote ICO (${SIZES.join(', ')}), window, loading, and tray variants`)
}

await main()
