import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  diagnosticEntries,
  exportDiagnostics,
  writeDiagnosticArchive,
  type DiagnosticOptions,
} from '../src/main/diagnostics.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-diagnostics-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function diagnosticOptions(directory: string): DiagnosticOptions {
  const logDirectory = join(directory, 'logs')
  const healthDirectory = join(directory, 'health')
  const log = join(logDirectory, 'desktop-2026-08-24T00-00-00-000Z.log')
  const active = join(healthDirectory, 'active-run.json')
  const healthy = join(healthDirectory, 'last-healthy.json')
  mkdirSync(logDirectory, { recursive: true })
  mkdirSync(healthDirectory, { recursive: true })
  writeFileSync(log, '{"event":"startup"}\n', { flag: 'w', flush: true })
  writeFileSync(active, '{"stage":"starting-service"}\n', { flag: 'w', flush: true })
  writeFileSync(healthy, '{"stage":"ready"}\n', { flag: 'w', flush: true })
  return {
    metadata: {
      desktopVersion: '0.1.0-rc.7',
      sourceVersion: '0.1.0-rc.7',
      upstreamRepository: 'https://github.com/deepseek-ai/deepseek-harness',
      upstreamCommit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      startupStage: 'ready',
      previousRunDetected: false,
      platform: 'win32',
      arch: 'x64',
      osRelease: 'test',
      electronVersion: '43.4.0',
      nodeVersion: '24.8.0',
    },
    logDirectory,
    logFiles: [log],
    activeRunPath: active,
    lastHealthyPath: healthy,
  }
}

describe('diagnostic export', () => {
  it('exports only metadata, bounded desktop logs, active-run, and last-healthy files', () => {
    const directory = temporaryDirectory()
    const options = diagnosticOptions(directory)

    expect(diagnosticEntries(options).map(entry => entry.archivePath)).toEqual([
      'metadata.json',
      'logs/desktop-2026-08-24T00-00-00-000Z.log',
      'health/active-run.json',
      'health/last-healthy.json',
    ])
  })

  it('rejects an arbitrary file disguised as a log', () => {
    const directory = temporaryDirectory()
    const options = diagnosticOptions(directory)
    const privateFile = join(directory, 'private.txt')
    writeFileSync(privateFile, 'private')

    expect(() => diagnosticEntries({ ...options, logFiles: [...options.logFiles, privateFile] }))
      .toThrow('diagnostic log is outside the desktop log directory')
  })

  it('requires privacy confirmation before choosing and writing an archive', async () => {
    const directory = temporaryDirectory()
    const options = diagnosticOptions(directory)
    const destination = join(directory, 'diagnostics.zip')
    const writeArchive = vi.fn(async () => undefined)
    const dialog = {
      showMessageBox: vi.fn(async () => ({ response: 0 })),
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: destination })),
    }

    await expect(exportDiagnostics({ diagnostics: options, defaultPath: destination, dialog, writeArchive }))
      .resolves.toBe(destination)
    expect(writeArchive).toHaveBeenCalledWith(destination, diagnosticEntries(options))
    expect(dialog.showMessageBox.mock.invocationCallOrder[0]).toBeLessThan(dialog.showSaveDialog.mock.invocationCallOrder[0]!)
  })

  it('writes a readable ZIP container with only the allowlisted entry names', async () => {
    const directory = temporaryDirectory()
    const options = diagnosticOptions(directory)
    const destination = join(directory, 'diagnostics.zip')

    await writeDiagnosticArchive(destination, diagnosticEntries(options))

    const archive = readFileSync(destination)
    expect(archive.subarray(0, 2).toString('ascii')).toBe('PK')
    const centralDirectoryText = archive.toString('latin1')
    expect(centralDirectoryText).toContain('metadata.json')
    expect(centralDirectoryText).toContain('health/last-healthy.json')
    expect(centralDirectoryText).not.toContain('private.txt')
  })
})
