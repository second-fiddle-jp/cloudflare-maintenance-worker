import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker, { createWorker } from '../src/index.js'

describe('createWorker', () => {
  it('answers with the functions passed as respond', async () => {
    const custom = createWorker({ respond: [() => new Response(null, { status: 409 })] })
    const res = await custom.fetch(new Request('https://example.com/'), {})

    assert.equal(res.status, 409)
  })

  it('stops with a reason when respond is not an array of functions', () => {
    assert.throws(() => createWorker({ respond: () => undefined }), /respond must be an array of functions/)
    assert.throws(() => createWorker({ respond: ['x'] }), /respond must be an array of functions/)
  })

  it('the default export is a Worker with no custom responses', async () => {
    const res = await worker.fetch(new Request('https://example.com/', { headers: { 'X-Inertia': 'true' } }), {})

    assert.equal(res.status, 503)
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8')
  })
})
