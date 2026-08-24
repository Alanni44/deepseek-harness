import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  activeRunPath,
  beginRun,
  clearActiveRun,
  lastHealthyPath,
  markRunHealthy,
  readRunRecord,
  type HealthOptions,
  type RunRecord,
} from '../src/main/health.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-health-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function record(runId: string, stage: RunRecord['stage'] = 'starting-service'): RunRecord {
  return {
    runId,
    desktopVersion: '0.1.0-rc.7',
    sourceVersion: '0.1.0-rc.7',
    upstreamCommit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
    stage,
    startedAt: '2026-08-24T00:00:00.000Z',
  }
}

describe('launch health records', () => {
  it('reports an unclean prior run and records then clears the current healthy run', () => {
    const directory = temporaryDirectory()
    const priorOptions: HealthOptions = { directory, record: record('prior'), now: () => new Date('2026-08-23T00:00:00Z') }
    beginRun(priorOptions)

    const current: HealthOptions = { directory, record: record('current'), now: () => new Date('2026-08-24T00:00:00Z') }
    expect(beginRun(current)).toEqual(record('prior'))
    markRunHealthy(current)

    expect(readRunRecord(lastHealthyPath(directory))).toMatchObject({
      runId: 'current',
      desktopVersion: current.record.desktopVersion,
      upstreamCommit: current.record.upstreamCommit,
      stage: 'ready',
      healthyAt: '2026-08-24T00:00:00.000Z',
    })
    expect(clearActiveRun(current)).toBe(true)
    expect(existsSync(activeRunPath(directory))).toBe(false)
  })

  it('preserves an unhealthy active marker for the next recovery launch', () => {
    const directory = temporaryDirectory()
    const current: HealthOptions = { directory, record: record('failed', 'failed'), now: () => new Date() }
    beginRun(current)

    expect(clearActiveRun(current)).toBe(false)
    expect(existsSync(activeRunPath(directory))).toBe(true)
  })
})
