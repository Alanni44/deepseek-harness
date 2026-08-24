import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDesktopLogger, pruneLogs, redactText } from '../src/main/logging.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-logging-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('desktop logging', () => {
  it('redacts credential-like values and rejects fields that can contain user content', () => {
    const directory = temporaryDirectory()
    const logger = createDesktopLogger({ directory, now: () => new Date('2026-08-24T00:00:00Z') })

    expect(redactText('Authorization: Bearer abc123 DEEPSEEK_API_KEY=secret')).not.toContain('abc123')
    expect(redactText('Authorization: Bearer abc123 DEEPSEEK_API_KEY=secret')).not.toContain('secret')
    expect(() => { logger.info('unsafe', { prompt: 'private' }) }).toThrow('diagnostic field prompt is forbidden')
    expect(() => { logger.info('unsafe', { session: 'private' }) }).toThrow('diagnostic field session is forbidden')

    logger.info('updater-error', { message: 'TOKEN=private-value' })
    const contents = readFileSync(logger.filePath, 'utf8')
    expect(contents).not.toContain('private-value')
    expect(JSON.parse(contents)).toMatchObject({ event: 'updater-error', message: 'TOKEN=[REDACTED]' })
  })

  it('rotates before a file exceeds its configured size', () => {
    const directory = temporaryDirectory()
    const logger = createDesktopLogger({
      directory,
      maxFileBytes: 220,
      now: () => new Date('2026-08-24T00:00:00Z'),
    })

    for (let index = 0; index < 8; index += 1) logger.info('bounded', { index, message: 'x'.repeat(28) })

    const files = readdirSync(directory).filter(file => file.endsWith('.log'))
    expect(files.length).toBeGreaterThan(1)
    expect(files.every(file => statSync(join(directory, file)).size <= 220)).toBe(true)
  })

  it('reserves space for the active file so rotated logs remain under the aggregate cap', () => {
    const directory = temporaryDirectory()
    const logger = createDesktopLogger({
      directory,
      maxFileBytes: 180,
      maxTotalBytes: 360,
      now: () => new Date('2026-08-24T00:00:00Z'),
    })

    for (let index = 0; index < 16; index += 1) logger.info('bounded', { index, message: 'x'.repeat(24) })

    const total = readdirSync(directory)
      .filter(file => file.endsWith('.log'))
      .reduce((bytes, file) => bytes + statSync(join(directory, file)).size, 0)
    expect(total).toBeLessThanOrEqual(360)
  })

  it('enforces retention, per-file bounds, and the total cap', () => {
    const directory = temporaryDirectory()
    mkdirSync(directory, { recursive: true })
    const old = join(directory, 'desktop-eight-days-old.log')
    const oversized = join(directory, 'desktop-oversized.log')
    const recent = join(directory, 'desktop-recent.log')
    writeFileSync(old, 'old')
    writeFileSync(oversized, 'a'.repeat(90))
    writeFileSync(recent, 'b'.repeat(60))
    utimesSync(old, new Date('2026-08-15T00:00:00Z'), new Date('2026-08-15T00:00:00Z'))
    utimesSync(oversized, new Date('2026-08-23T00:00:00Z'), new Date('2026-08-23T00:00:00Z'))
    utimesSync(recent, new Date('2026-08-24T00:00:00Z'), new Date('2026-08-24T00:00:00Z'))

    const result = pruneLogs({
      directory,
      now: new Date('2026-08-24T00:00:00Z'),
      maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
      maxFileBytes: 64,
      maxTotalBytes: 100,
    })

    expect(result.remainingBytes).toBeLessThanOrEqual(100)
    expect(result.files.every(file => file.size <= 64)).toBe(true)
    expect(result.files.some(file => file.name === 'desktop-eight-days-old.log')).toBe(false)
    expect(result.removed).toContain('desktop-eight-days-old.log')
  })
})
