import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError, applyOn, describeOnFailure } from '../scripts/apply-on.mjs'

const create = ['example.com/*', 'app.example.com/*', 'admin.example.com/*']
const workerNotFound = new ApiError('POST /zones/z/workers/routes failed: HTTP 400', [
  { code: 10019, message: 'Cannot configure a route for a Worker which does not exist.' },
])

/** A post that records the patterns it was called with and throws error on call number failAt (0-based). */
const fakePost = (failAt, error) => {
  const calls = []
  const post = async (pattern) => {
    if (calls.length === failAt) {
      calls.push(pattern)
      throw error
    }
    calls.push(pattern)
  }
  return { post, calls }
}

describe('applyOn', () => {
  it('returns every pattern in created when all are attached', async () => {
    const { post, calls } = fakePost(-1)

    const result = await applyOn({ create, post })

    assert.deepEqual(result, { created: create, error: undefined })
    assert.deepEqual(calls, create)
  })

  it('stops at the first POST when the Worker does not exist, attaching nothing', async () => {
    const { post, calls } = fakePost(0, workerNotFound)

    const result = await applyOn({ create, post })

    assert.deepEqual(result, { created: [], error: workerNotFound })
    assert.deepEqual(calls, ['example.com/*'])
  })

  it('on a failure part way, returns what was attached and posts nothing more', async () => {
    const error = new ApiError('HTTP 500', [{ code: 10000, message: 'Internal' }])
    const { post, calls } = fakePost(1, error)

    const result = await applyOn({ create, post })

    assert.deepEqual(result, { created: ['example.com/*'], error })
    assert.deepEqual(calls, ['example.com/*', 'app.example.com/*'])
  })
})

describe('describeOnFailure', () => {
  const base = { envName: 'production', script: 'example-maintenance-production', total: 3 }

  it('with no Worker and no routes, points to deploy and does not mention partial maintenance', () => {
    const message = describeOnFailure({ ...base, error: workerNotFound, attached: 0 })

    assert.match(message, /example-maintenance-production/)
    assert.match(message, /deploy production/)
    assert.doesNotMatch(message, /pnpm|--dir/)
    assert.match(message, /No routes were attached/)
    assert.doesNotMatch(message, /some hosts/i)
  })

  it('with nothing attached for another reason, mentions neither partial maintenance nor deploy', () => {
    const error = new ApiError('HTTP 403', [{ code: 10000, message: 'Authentication error' }])

    const message = describeOnFailure({ ...base, error, attached: 0 })

    assert.match(message, /No routes were attached/)
    assert.doesNotMatch(message, /some hosts/i)
    assert.doesNotMatch(message, /deploy /)
  })

  it('with some routes attached, reports partial maintenance', () => {
    const error = new ApiError('HTTP 500', [{ code: 10000, message: 'Internal' }])

    const message = describeOnFailure({ ...base, error, attached: 1 })

    assert.match(message, /Only some hosts are in maintenance/)
    assert.match(message, /status production/)
    assert.match(message, /off production/)
  })

  it('with routes left behind, reports partial maintenance even for code 10019', () => {
    const message = describeOnFailure({ ...base, error: workerNotFound, attached: 2 })

    assert.match(message, /Only some hosts are in maintenance/)
  })

  it('with every route attached despite the failure, does not report partial maintenance', () => {
    const error = new ApiError('HTTP 502')

    const message = describeOnFailure({ ...base, error, attached: 3 })

    assert.match(message, /all 3 routes are attached/)
    assert.doesNotMatch(message, /some hosts/i)
  })

  it('when the route list could not be fetched again, asks the operator to check because the outcome is unknown', () => {
    const message = describeOnFailure({ ...base, error: workerNotFound, attached: undefined })

    assert.match(message, /Some hosts may be in maintenance/)
    assert.match(message, /status production/)
    assert.doesNotMatch(message, /No routes were attached/)
    assert.doesNotMatch(message, /deploy /)
  })

  it('with nothing attached this time but routes attached earlier by on --host, says those hosts stay in maintenance', () => {
    const error = new ApiError('HTTP 500', [{ code: 10000, message: 'Internal' }])

    const message = describeOnFailure({ ...base, total: 1, error, attached: 0, elsewhere: 2 })

    assert.match(message, /No routes were attached for the selected hosts/)
    assert.match(message, /2 routes attached earlier/)
    assert.match(message, /status production/)
    assert.doesNotMatch(message, /serving normally/)
  })

  it('on a network error with zero routes in the fresh list, says nothing was attached', () => {
    const message = describeOnFailure({ ...base, error: new TypeError('fetch failed'), attached: 0 })

    assert.match(message, /No routes were attached/)
    assert.doesNotMatch(message, /some hosts/i)
    assert.doesNotMatch(message, /deploy /)
  })
})
