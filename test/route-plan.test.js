import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findShadowingRoutes, planOff, planOn, selectHosts } from '../scripts/route-plan.mjs'

const target = { script: 'example-maintenance-production', patterns: ['example.com/*', 'app.example.com/*'] }

describe('planOn', () => {
  it('creates only the routes that do not exist yet', () => {
    const existing = [{ id: 'r1', pattern: 'example.com/*', script: 'example-maintenance-production' }]

    assert.deepEqual(planOn(existing, target), { create: ['app.example.com/*'], conflicts: [] })
  })

  it('reports a pattern held by another Worker as a conflict and does not create it', () => {
    const existing = [{ id: 'r9', pattern: 'app.example.com/*', script: 'someone-else' }]

    assert.deepEqual(planOn(existing, target), { create: ['example.com/*'], conflicts: existing })
  })
})

describe('planOff', () => {
  it('deletes only this maintenance Worker routes', () => {
    const ours = { id: 'r1', pattern: 'example.com/*', script: 'example-maintenance-production' }
    const devOurs = { id: 'r2', pattern: 'dev.example.com/*', script: 'example-maintenance-develop' }
    const other = { id: 'r3', pattern: 'app.example.com/*', script: 'someone-else' }

    assert.deepEqual(planOff([ours, devOurs, other], target), [ours])
  })
})

describe('findShadowingRoutes', () => {
  it('returns routes of other Workers on the target hosts', () => {
    const api = { id: 'r1', pattern: 'app.example.com/api/*', script: 'someone-else' }

    assert.deepEqual(findShadowingRoutes([api], target), [api])
  })

  it('does not return this maintenance Worker routes', () => {
    const ours = { id: 'r1', pattern: 'app.example.com/*', script: 'example-maintenance-production' }

    assert.deepEqual(findShadowingRoutes([ours], target), [])
  })

  it('does not return other Workers on hosts outside the target', () => {
    const assets = { id: 'r2', pattern: 'assets.example.com/*', script: 'someone-else' }

    assert.deepEqual(findShadowingRoutes([assets], target), [])
  })
})

describe('selectHosts', () => {
  const patterns = ['example.com/*', 'app.example.com/*', 'api.example.com/*']

  it('keeps the patterns of the given hosts, in the order of the config', () => {
    assert.deepEqual(selectHosts(patterns, ['api.example.com', 'example.com']), {
      patterns: ['example.com/*', 'api.example.com/*'],
      unknown: [],
    })
  })

  it('compares the whole host, so example.com does not match app.example.com', () => {
    assert.deepEqual(selectHosts(patterns, ['example.com']).patterns, ['example.com/*'])
  })

  it('returns hosts that no pattern has as unknown', () => {
    assert.deepEqual(selectHosts(patterns, ['app.example.com', 'www.example.com']), {
      patterns: ['app.example.com/*'],
      unknown: ['www.example.com'],
    })
  })
})
