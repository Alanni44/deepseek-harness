import { describe, expect, it } from 'vitest'
import { validateRelease, type ReleaseValidationInput } from '../scripts/verify-upstream.ts'

function validInput(overrides: Partial<ReleaseValidationInput> = {}): ReleaseValidationInput {
  return {
    tag: 'desktop-v0.1.0-rc.7',
    desktopPackage: { version: '0.1.0-rc.7' },
    sourcePackage: { version: '0.1.0-rc.7' },
    upstream: {
      repository: 'https://github.com/deepseek-ai/deepseek-harness',
      commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      sourceVersion: '0.1.0-rc.7',
      desktopVersion: '0.1.0-rc.7',
    },
    isAncestorOfHead: true,
    isAncestorOfOfficial: true,
    ...overrides,
  }
}

describe('validateRelease', () => {
  it('accepts a consistent desktop tag and official upstream baseline', () => {
    expect(validateRelease(validInput())).toEqual([])
  })

  it('rejects tag, package, repository, SHA, and ancestry mismatches together', () => {
    const input = validInput({
      tag: 'desktop-v0.1.0-rc.8',
      upstream: {
        repository: 'https://github.com/example/not-official',
        commit: 'short-sha',
        sourceVersion: '0.1.0-rc.8',
        desktopVersion: '0.1.0-rc.8',
      },
      isAncestorOfHead: false,
      isAncestorOfOfficial: false,
    })

    expect(validateRelease(input)).toEqual([
      'tag version 0.1.0-rc.8 does not match desktop version 0.1.0-rc.7',
      'upstream desktopVersion does not match apps/desktop/package.json',
      'upstream sourceVersion does not match apps/cli/package.json',
      'upstream repository is not the official repository',
      'upstream commit is not a full SHA-1',
      'upstream commit is not an ancestor of the release commit',
      'upstream commit is not an ancestor of official/master',
    ])
  })

  it('rejects tags outside the desktop-v namespace', () => {
    expect(validateRelease(validInput({ tag: 'v0.1.0-rc.7' }))[0]).toBe('tag must use desktop-v<version>')
  })
})
