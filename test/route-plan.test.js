import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findShadowingRoutes, planOff, planOn } from '../scripts/route-plan.mjs'

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
