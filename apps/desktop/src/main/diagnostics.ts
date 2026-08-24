/** Native-confirmed, allowlisted ZIP diagnostic export. */

import { ZipArchive } from 'archiver'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { MAX_LOG_FILE_BYTES } from './logging.ts'
import type { StartupStage } from './health.ts'

const MAX_HEALTH_FILE_BYTES = 64 * 1024

export interface DiagnosticMetadata {
  desktopVersion: string
  sourceVersion: string
  upstreamRepository: string
  upstreamCommit: string
  startupStage: StartupStage
  previousRunDetected: boolean
  platform: string
  arch: string
  osRelease: string
  electronVersion: string
  nodeVersion: string
}

export type DiagnosticEntry =
  | { kind: 'buffer'; archivePath: string; data: Buffer }
  | { kind: 'file'; archivePath: string; sourcePath: string }

export interface DiagnosticOptions {
  metadata: DiagnosticMetadata
  logDirectory: string
  logFiles: readonly string[]
  activeRunPath: string
  lastHealthyPath: string
}

export interface DiagnosticDialog {
  showMessageBox(options: {
    type: 'warning'
    title: string
    message: string
    detail: string
    buttons: string[]
    defaultId: number
    cancelId: number
  }): Promise<{ response: number }>
  showSaveDialog(options: {
    defaultPath: string
    filters: Array<{ name: string; extensions: string[] }>
  }): Promise<{ canceled: boolean; filePath?: string }>
}

export interface ExportDiagnosticOptions {
  diagnostics: DiagnosticOptions
  defaultPath: string
  dialog: DiagnosticDialog
  writeArchive?: (destination: string, entries: readonly DiagnosticEntry[]) => Promise<void>
}

function isContainedFile(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot !== '' && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot)
}

function validateLogFile(logDirectory: string, path: string): void {
  if (!isContainedFile(logDirectory, path)) throw new Error('diagnostic log is outside the desktop log directory')
  if (!/^desktop-[A-Za-z0-9._-]+\.log$/u.test(basename(path))) throw new Error('diagnostic log filename is not allowlisted')
  const stats = statSync(path)
  if (!stats.isFile() || stats.size > MAX_LOG_FILE_BYTES) throw new Error('diagnostic log exceeds the allowlisted bounds')
}

function addHealthEntry(entries: DiagnosticEntry[], path: string, expectedName: string): void {
  if (!existsSync(path)) return
  if (basename(path) !== expectedName || statSync(path).size > MAX_HEALTH_FILE_BYTES) {
    throw new Error(`diagnostic health file ${expectedName} is not allowlisted`)
  }
  entries.push({ kind: 'file', archivePath: join('health', expectedName).replaceAll('\\', '/'), sourcePath: path })
}

/** Construct the complete and exclusive diagnostic archive allowlist. */
export function diagnosticEntries(options: DiagnosticOptions): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [{
    kind: 'buffer',
    archivePath: 'metadata.json',
    data: Buffer.from(`${JSON.stringify(options.metadata, null, 2)}\n`),
  }]
  for (const file of [...options.logFiles].sort((left, right) => basename(left).localeCompare(basename(right)))) {
    validateLogFile(options.logDirectory, file)
    entries.push({ kind: 'file', archivePath: `logs/${basename(file)}`, sourcePath: file })
  }
  if (dirname(resolve(options.activeRunPath)) !== dirname(resolve(options.lastHealthyPath))) {
    throw new Error('diagnostic health files must share one directory')
  }
  addHealthEntry(entries, options.activeRunPath, 'active-run.json')
  addHealthEntry(entries, options.lastHealthyPath, 'last-healthy.json')
  return entries
}

/** Write diagnostic entries as a ZIP archive using maximum compression. */
export async function writeDiagnosticArchive(destination: string, entries: readonly DiagnosticEntry[]): Promise<void> {
  await new Promise<void>((resolveArchive, rejectArchive) => {
    const output = createWriteStream(destination, { flags: 'wx' })
    const archive = new ZipArchive({ zlib: { level: 9 } })
    output.once('close', resolveArchive)
    output.once('error', rejectArchive)
    archive.once('error', rejectArchive)
    archive.pipe(output)
    for (const entry of entries) {
      if (entry.kind === 'buffer') archive.append(entry.data, { name: entry.archivePath })
      else archive.file(entry.sourcePath, { name: entry.archivePath })
    }
    void archive.finalize()
  })
}

/** Ask for privacy consent and a destination before creating diagnostics. */
export async function exportDiagnostics(options: ExportDiagnosticOptions): Promise<string | undefined> {
  const consent = await options.dialog.showMessageBox({
    type: 'warning',
    title: 'Export Diagnostics',
    message: 'The archive contains app versions, startup status, and bounded desktop logs.',
    detail: 'It excludes credentials, prompts, sessions, environment variables, and user files. Review the ZIP before sharing it.',
    buttons: ['Export', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  if (consent.response !== 0) return undefined
  const destination = await options.dialog.showSaveDialog({
    defaultPath: options.defaultPath,
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
  })
  if (destination.canceled || destination.filePath === undefined) return undefined
  const entries = diagnosticEntries(options.diagnostics)
  await (options.writeArchive ?? writeDiagnosticArchive)(destination.filePath, entries)
  return destination.filePath
}
