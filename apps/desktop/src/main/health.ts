/** Atomic launch-health markers used for evidence and recovery UI decisions. */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export type StartupStage = 'starting-service' | 'loading-interface' | 'ready' | 'failed'

export interface RunRecord {
  runId: string
  desktopVersion: string
  sourceVersion: string
  upstreamCommit: string
  stage: StartupStage
  startedAt: string
  healthyAt?: string
}

export interface HealthOptions {
  directory: string
  record: RunRecord
  now: () => Date
}

export function activeRunPath(directory: string): string {
  return join(directory, 'active-run.json')
}

export function lastHealthyPath(directory: string): string {
  return join(directory, 'last-healthy.json')
}

function isStartupStage(value: unknown): value is StartupStage {
  return value === 'starting-service' || value === 'loading-interface' || value === 'ready' || value === 'failed'
}

/** Read a valid run marker; malformed or absent evidence is ignored safely. */
export function readRunRecord(path: string): RunRecord | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (
      typeof record.runId !== 'string'
      || typeof record.desktopVersion !== 'string'
      || typeof record.sourceVersion !== 'string'
      || typeof record.upstreamCommit !== 'string'
      || !isStartupStage(record.stage)
      || typeof record.startedAt !== 'string'
      || (record.healthyAt !== undefined && typeof record.healthyAt !== 'string')
    ) return undefined
    return record as unknown as RunRecord
  } catch {
    return undefined
  }
}

function writeJsonAtomic(path: string, value: RunRecord): void {
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    renameSync(temporaryPath, path)
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
}

/** Replace any stale active marker and return it as prior-run evidence. */
export function beginRun(options: HealthOptions): RunRecord | undefined {
  mkdirSync(options.directory, { recursive: true })
  const prior = readRunRecord(activeRunPath(options.directory))
  writeJsonAtomic(activeRunPath(options.directory), options.record)
  return prior
}

/** Mark both the current and last-known run healthy after the renderer loads. */
export function markRunHealthy(options: HealthOptions): RunRecord {
  const healthy: RunRecord = { ...options.record, stage: 'ready', healthyAt: options.now().toISOString() }
  writeJsonAtomic(activeRunPath(options.directory), healthy)
  writeJsonAtomic(lastHealthyPath(options.directory), healthy)
  return healthy
}

/** Clear only this run's healthy marker; failed runs remain for recovery evidence. */
export function clearActiveRun(options: HealthOptions): boolean {
  const path = activeRunPath(options.directory)
  const active = readRunRecord(path)
  if (active?.runId !== options.record.runId || active.stage !== 'ready') return false
  unlinkSync(path)
  return true
}
