import assert from 'node:assert/strict'
import { findPackagedReadyUrl } from '../scripts/smoke-readiness.mjs'

assert.equal(
  findPackagedReadyUrl('startup detail\ndsh web: http://127.0.0.1:3187\n'),
  'http://127.0.0.1:3187',
)
assert.equal(findPackagedReadyUrl('dsh web: https://example.test'), undefined)
