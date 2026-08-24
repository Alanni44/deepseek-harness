/**
 * Validate that a desktop release tag and provenance record agree with the
 * desktop package, source package, release commit, and fetched official ref.
 * @module @deepseek-ai/dsh-desktop/verify-upstream
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OFFICIAL_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness'
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DESKTOP_ROOT = resolve(dirname(SCRIPT_PATH), '..')
const REPOSITORY_ROOT = resolve(DESKTOP_ROOT, '..', '..')

/** Package metadata used by release provenance validation. */
export interface VersionPackage {
  /** Package SemVer. */
  version: string
}

/** Official source baseline recorded for one desktop release. */
export interface UpstreamRecord {
  /** Canonical official GitHub repository URL. */
  repository: string
  /** Full official source commit SHA-1. */
  commit: string
  /** Version of the synchronized dsh source package. */
  sourceVersion: string
  /** Version of the desktop package that records this baseline. */
  desktopVersion: string
}

/** Inputs for pure release/provenance validation. */
export interface ReleaseValidationInput {
  /** Git tag that triggers the release. */
  tag: string
  /** Desktop package metadata. */
  desktopPackage: VersionPackage
  /** CLI source package metadata. */
  sourcePackage: VersionPackage
  /** Reviewed upstream baseline. */
  upstream: UpstreamRecord
  /** Whether the upstream commit is contained by the release commit. */
  isAncestorOfHead: boolean
  /** Whether the upstream commit is contained by the fetched official branch. */
  isAncestorOfOfficial: boolean
}

/**
 * Return every release/provenance mismatch in stable diagnostic order.
 * @param input - release values and precomputed ancestry results.
 * @returns validation errors; an empty array means the record is consistent.
 */
export function validateRelease(input: ReleaseValidationInput): string[] {
  const errors: string[] = []
  const hasDesktopPrefix = input.tag.startsWith('desktop-v')
  const tagVersion = hasDesktopPrefix ? input.tag.slice('desktop-v'.length) : ''
  if (!hasDesktopPrefix) errors.push('tag must use desktop-v<version>')
  if (hasDesktopPrefix && tagVersion !== input.desktopPackage.version) {
    errors.push(`tag version ${tagVersion} does not match desktop version ${input.desktopPackage.version}`)
  }
  if (input.upstream.desktopVersion !== input.desktopPackage.version) {
    errors.push('upstream desktopVersion does not match apps/desktop/package.json')
  }
  if (input.upstream.sourceVersion !== input.sourcePackage.version) {
    errors.push('upstream sourceVersion does not match apps/cli/package.json')
  }
  if (input.upstream.repository !== OFFICIAL_REPOSITORY) {
    errors.push('upstream repository is not the official repository')
  }
  if (!/^[0-9a-f]{40}$/.test(input.upstream.commit)) {
    errors.push('upstream commit is not a full SHA-1')
  }
  if (!input.isAncestorOfHead) {
    errors.push('upstream commit is not an ancestor of the release commit')
  }
  if (!input.isAncestorOfOfficial) {
    errors.push('upstream commit is not an ancestor of official/master')
  }
  return errors
}

function readUnknownJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function recordWithStrings(value: unknown, fields: readonly string[], subject: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be a JSON object`)
  }
  const record = value as Record<string, unknown>
  for (const field of fields) {
    if (typeof record[field] !== 'string') throw new Error(`${subject}.${field} must be a string`)
  }
  return record as Record<string, string>
}

function readVersionPackage(path: string): VersionPackage {
  const record = recordWithStrings(readUnknownJson(path), ['version'], path)
  return { version: record.version! }
}

function readUpstreamRecord(path: string): UpstreamRecord {
  const record = recordWithStrings(
    readUnknownJson(path),
    ['repository', 'commit', 'sourceVersion', 'desktopVersion'],
    path,
  )
  return {
    repository: record.repository!,
    commit: record.commit!,
    sourceVersion: record.sourceVersion!,
    desktopVersion: record.desktopVersion!,
  }
}

function optionValue(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined) throw new Error(`missing required option ${name}`)
  return value
}

function isAncestor(commit: string, descendant: string): boolean {
  return spawnSync('git', ['merge-base', '--is-ancestor', commit, descendant], {
    cwd: REPOSITORY_ROOT,
    stdio: 'ignore',
  }).status === 0
}

function main(): void {
  const tag = optionValue('--tag')
  const head = optionValue('--head')
  const officialRef = optionValue('--official-ref')
  const desktopPackage = readVersionPackage(resolve(DESKTOP_ROOT, 'package.json'))
  const sourcePackage = readVersionPackage(resolve(REPOSITORY_ROOT, 'apps', 'cli', 'package.json'))
  const upstream = readUpstreamRecord(resolve(DESKTOP_ROOT, 'upstream.json'))
  const errors = validateRelease({
    tag,
    desktopPackage,
    sourcePackage,
    upstream,
    isAncestorOfHead: isAncestor(upstream.commit, head),
    isAncestorOfOfficial: isAncestor(upstream.commit, officialRef),
  })
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`verify-upstream: ${error}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`verify-upstream: ${tag} records ${upstream.repository}@${upstream.commit}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_PATH) main()
