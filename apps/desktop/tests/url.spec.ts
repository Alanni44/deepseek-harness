import { describe, expect, it } from 'vitest'
import { findWebUrl, isAllowedAppNavigation, parseWebUrlLine } from '../src/main/url.ts'

describe('parseWebUrlLine', () => {
  it('extracts the loopback URL from the readiness line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080')
  })

  it('extracts the URL when a LAN suffix follows', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:41234 (LAN: http://192.168.1.2:41234)'))
      .toBe('http://127.0.0.1:41234')
  })

  it('returns undefined for a non-loopback or non-readiness line', () => {
    expect(parseWebUrlLine('dsh web: http://0.0.0.0:3080')).toBeUndefined()
    expect(parseWebUrlLine('some unrelated log')).toBeUndefined()
    expect(parseWebUrlLine('')).toBeUndefined()
  })
})

describe('findWebUrl', () => {
  it('finds the readiness line among other output', () => {
    const output = 'boot log\ndsh web: http://127.0.0.1:3080\nmore log\n'
    expect(findWebUrl(output)).toBe('http://127.0.0.1:3080')
  })

  it('returns undefined before the readiness line appears', () => {
    expect(findWebUrl('partial log without the url\n')).toBeUndefined()
  })
})

describe('isAllowedAppNavigation', () => {
  it('allows navigation only within the exact backend origin', () => {
    expect(isAllowedAppNavigation('http://127.0.0.1:3080', 'http://127.0.0.1:3080/session/1')).toBe(true)
    expect(isAllowedAppNavigation('http://127.0.0.1:3080', 'http://127.0.0.1:3080.evil.test/')).toBe(false)
    expect(isAllowedAppNavigation('http://127.0.0.1:3080', 'https://example.com/')).toBe(false)
    expect(isAllowedAppNavigation('http://127.0.0.1:3080', 'not a URL')).toBe(false)
  })
})
