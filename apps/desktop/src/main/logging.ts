/** Bounded, privacy-preserving JSONL logging for the desktop shell. */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024
export const MAX_LOG_TOTAL_BYTES = 200 * 1024 * 1024
export const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1_000

const FORBIDDEN_FIELD_PARTS = [
  'apikey',
  'credential',
  'environment',
  'password',
  'prompt',
  'secret',
  'session',
  'token',
] as const

export interface LogFileRecord {
  name: string
  path: string
  size: number
  mtimeMs: number
}

export interface PruneLogOptions {
  directory: string
  now?: Date
  maxAgeMs?: number
  maxFileBytes?: number
  maxTotalBytes?: number
}

export interface PruneResult {
  files: LogFileRecord[]
  removed: string[]
  remainingBytes: number
}

export interface DesktopLogger {
  readonly filePath: string
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export interface CreateDesktopLoggerOptions {
  directory: string
  now?: () => Date
  maxFileBytes?: number
  maxTotalBytes?: number
  maxAgeMs?: number
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function normalizedFieldName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z]/gu, '')
}

/** Reject diagnostic fields that could intentionally carry private user data. */
export function assertDiagnosticFields(fields: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(fields)) {
    const normalized = normalizedFieldName(name)
    if (FORBIDDEN_FIELD_PARTS.some(part => normalized.includes(part))) {
      throw new Error(`diagnostic field ${name} is forbidden`)
    }
    if (isPlainRecord(value)) assertDiagnosticFields(value)
    if (Array.isArray(value)) {
      for (const item of value) if (isPlainRecord(item)) assertDiagnosticFields(item)
    }
  }
}

/** Remove common bearer and environment-style secret values from free text. */
export function redactText(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/giu, '$1[REDACTED]')
    .replace(/([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s,;]+/giu, '$1[REDACTED]')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeDiagnosticValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) }
  if (Array.isArray(value)) return value.map(safeDiagnosticValue)
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, safeDiagnosticValue(item)]))
  }
  return value
}

function isDesktopLog(name: string): boolean {
  return /^desktop-[A-Za-z0-9._-]+\.log$/u.test(name)
}

function listLogFiles(directory: string): LogFileRecord[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && isDesktopLog(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name)
      const stats = statSync(path)
      return { name: entry.name, path, size: stats.size, mtimeMs: stats.mtimeMs }
    })
}

function truncateToTail(path: string, maximumBytes: number): void {
  const contents = readFileSync(path)
  if (contents.byteLength <= maximumBytes) return
  const tail = contents.subarray(contents.byteLength - maximumBytes)
  const firstNewline = tail.indexOf(0x0A)
  const bounded = firstNewline >= 0 && firstNewline + 1 < tail.byteLength ? tail.subarray(firstNewline + 1) : tail
  writeFileSync(path, bounded)
}

/** Enforce log age, individual-file, and aggregate retention limits. */
export function pruneLogs(options: PruneLogOptions): PruneResult {
  const now = options.now ?? new Date()
  const maxAgeMs = options.maxAgeMs ?? MAX_LOG_AGE_MS
  const maxFileBytes = options.maxFileBytes ?? MAX_LOG_FILE_BYTES
  const maxTotalBytes = options.maxTotalBytes ?? MAX_LOG_TOTAL_BYTES
  const removed: string[] = []
  mkdirSync(options.directory, { recursive: true })

  for (const file of listLogFiles(options.directory)) {
    if (file.mtimeMs < now.getTime() - maxAgeMs) {
      unlinkSync(file.path)
      removed.push(file.name)
    } else if (file.size > maxFileBytes) {
      truncateToTail(file.path, maxFileBytes)
    }
  }

  const oldestFirst = listLogFiles(options.directory).sort((left, right) =>
    left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
  let remainingBytes = oldestFirst.reduce((total, file) => total + file.size, 0)
  while (remainingBytes > maxTotalBytes && oldestFirst.length > 0) {
    const oldest = oldestFirst.shift()
    if (oldest === undefined) break
    unlinkSync(oldest.path)
    removed.push(oldest.name)
    remainingBytes -= oldest.size
  }

  const files = listLogFiles(options.directory).sort((left, right) => left.name.localeCompare(right.name))
  return { files, removed, remainingBytes: files.reduce((total, file) => total + file.size, 0) }
}

function timestampForFilename(now: Date): string {
  return now.toISOString().replaceAll(/[:.]/gu, '-')
}

function nextLogPath(directory: string, now: Date, sequence: number): string {
  const suffix = sequence === 0 ? '' : `-${String(sequence).padStart(3, '0')}`
  return join(directory, `desktop-${timestampForFilename(now)}${suffix}.log`)
}

/** Create a synchronous logger suitable for early startup and crash evidence. */
export function createDesktopLogger(options: CreateDesktopLoggerOptions): DesktopLogger {
  const now = options.now ?? (() => new Date())
  const maxFileBytes = options.maxFileBytes ?? MAX_LOG_FILE_BYTES
  const maxTotalBytes = options.maxTotalBytes ?? MAX_LOG_TOTAL_BYTES
  if (maxFileBytes < 128) throw new Error('desktop log file limit must be at least 128 bytes')
  if (maxTotalBytes < maxFileBytes) throw new Error('desktop total log limit must be at least one log file')
  const retainedBeforeCurrentBytes = maxTotalBytes - maxFileBytes
  const pruneOptions: PruneLogOptions = {
    directory: options.directory,
    now: now(),
    maxFileBytes,
    maxTotalBytes: retainedBeforeCurrentBytes,
    ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs }),
  }
  pruneLogs(pruneOptions)

  let sequence = 0
  let currentPath = nextLogPath(options.directory, now(), sequence)
  while (existsSync(currentPath)) {
    sequence += 1
    currentPath = nextLogPath(options.directory, now(), sequence)
  }

  const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}): void => {
    assertDiagnosticFields(fields)
    const timestamp = now().toISOString()
    const safeFields = safeDiagnosticValue(fields)
    let line = `${JSON.stringify({ timestamp, level, event: redactText(event), ...safeFields as Record<string, unknown> })}\n`
    if (Buffer.byteLength(line) > maxFileBytes) {
      line = `${JSON.stringify({ timestamp, level, event: redactText(event), truncated: true })}\n`
    }
    const currentBytes = existsSync(currentPath) ? statSync(currentPath).size : 0
    if (currentBytes > 0 && currentBytes + Buffer.byteLength(line) > maxFileBytes) {
      pruneLogs({ ...pruneOptions, now: now() })
      sequence += 1
      currentPath = nextLogPath(options.directory, now(), sequence)
    }
    appendFileSync(currentPath, line, 'utf8')
  }

  return {
    get filePath() { return currentPath },
    debug: (event, fields) => { write('debug', event, fields) },
    info: (event, fields) => { write('info', event, fields) },
    warn: (event, fields) => { write('warn', event, fields) },
    error: (event, fields) => { write('error', event, fields) },
  }
}
