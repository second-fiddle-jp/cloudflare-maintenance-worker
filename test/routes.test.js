import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { routes } from '../scripts/routes.mjs'

const SCRIPT = 'acme-maintenance-live'
const PATTERNS = ['acme.test/*', 'app.acme.test/*', 'api.acme.test/*']

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'maintenance-routes-'))
  writeFileSync(join(dir, 'wrangler.jsonc'), '{ "name": "acme-maintenance", "env": { "live": {} } }')
  writeFileSync(join(dir, 'maintenance.config.json'), JSON.stringify({ zone: 'acme.test', environments: { live: { patterns: PATTERNS } } }))
  return dir
}

/** Stands in for the Cloudflare API with an in-memory route list. */
const fakeCloudflare = (initial = []) => {
  const state = { routes: initial.map((route, i) => ({ id: `r${i}`, ...route })), posted: [], deleted: [] }
  const ok = (result) => new Response(JSON.stringify({ success: true, result, errors: [] }), { headers: { 'content-type': 'application/json' } })
  const fetch = async (url, { method, body }) => {
    const path = new URL(url).pathname.replace('/client/v4', '')
    if (method === 'GET' && path === '/zones') return ok([{ id: 'zone1' }])
    if (method === 'GET' && path === '/zones/zone1/workers/routes') return ok(state.routes)
    if (method === 'POST' && path === '/zones/zone1/workers/routes') {
      const route = { id: `n${state.posted.length}`, ...JSON.parse(body) }
      state.routes.push(route)
      state.posted.push(route.pattern)
      return ok(route)
    }
    const removed = path.match(/^\/zones\/zone1\/workers\/routes\/(.+)$/)
    if (method === 'DELETE' && removed) {
      state.routes = state.routes.filter((route) => route.id !== removed[1])
      state.deleted.push(removed[1])
      return ok({ id: removed[1] })
    }
    throw new Error(`unexpected ${method} ${path}`)
  }
  return { state, fetch }
}

describe('routes', () => {
  let out
  let err
  beforeEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = 'test-token'
    out = mock.method(console, 'log', () => {})
    err = mock.method(console, 'error', () => {})
  })
  afterEach(() => {
    delete process.env.CLOUDFLARE_API_TOKEN
    mock.restoreAll()
  })
  const printed = (spy) => spy.mock.calls.map((call) => call.arguments.join(' ')).join('\n')

  it('on attaches every pattern of the environment without --host', async () => {
    const cf = fakeCloudflare()
    mock.method(globalThis, 'fetch', cf.fetch)

    assert.equal(await routes(['on', 'live'], project()), 0)
    assert.deepEqual(cf.state.posted, PATTERNS)
    assert.match(printed(out), /In maintenance: 3 \/ 3 routes/)
  })

  it('on --host attaches only the patterns of the given hosts', async () => {
    const cf = fakeCloudflare()
    mock.method(globalThis, 'fetch', cf.fetch)

    assert.equal(await routes(['on', 'live', '--host', 'app.acme.test', '--host=api.acme.test'], project()), 0)
    assert.deepEqual(cf.state.posted, ['app.acme.test/*', 'api.acme.test/*'])
    assert.match(printed(out), /In maintenance: 2 \/ 3 routes/)
  })

  it('on --host adds a host to a partial maintenance without recreating the attached route', async () => {
    const cf = fakeCloudflare([{ pattern: 'app.acme.test/*', script: SCRIPT }])
    mock.method(globalThis, 'fetch', cf.fetch)

    assert.equal(await routes(['on', 'live', '--host', 'acme.test', '--host', 'app.acme.test'], project()), 0)
    assert.deepEqual(cf.state.posted, ['acme.test/*'])
  })

  it('on --host checks conflicts only on the selected patterns', async () => {
    const cf = fakeCloudflare([{ pattern: 'acme.test/*', script: 'someone-else' }])
    mock.method(globalThis, 'fetch', cf.fetch)

    assert.equal(await routes(['on', 'live', '--host', 'app.acme.test'], project()), 0)
    assert.deepEqual(cf.state.posted, ['app.acme.test/*'])
  })

  it('when on --host fails, counts only the selected patterns and mentions the hosts attached earlier', async () => {
    const cf = fakeCloudflare([{ pattern: 'app.acme.test/*', script: SCRIPT }])
    mock.method(globalThis, 'fetch', async (url, init) => {
      if (init.method === 'POST') {
        return new Response(JSON.stringify({ success: false, result: null, errors: [{ code: 10000, message: 'Internal' }] }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      return cf.fetch(url, init)
    })

    assert.equal(await routes(['on', 'live', '--host', 'acme.test'], project()), 1)
    assert.match(printed(err), /No routes were attached for the selected hosts/)
    assert.doesNotMatch(printed(err), /all 1 routes are attached/)
  })

  it('off removes every route of this Worker after a partial maintenance', async () => {
    const cf = fakeCloudflare([
      { pattern: 'app.acme.test/*', script: SCRIPT },
      { pattern: 'other.acme.test/*', script: 'someone-else' },
    ])
    mock.method(globalThis, 'fetch', cf.fetch)

    assert.equal(await routes(['off', 'live'], project()), 0)
    assert.deepEqual(cf.state.deleted, ['r0'])
    assert.match(printed(out), /No maintenance routes/)
  })

  it('status warns about narrower routes only on the hosts in maintenance', async () => {
    const cf = fakeCloudflare([
      { pattern: 'app.acme.test/*', script: SCRIPT },
      { pattern: 'app.acme.test/hooks/*', script: 'hooks' },
      { pattern: 'api.acme.test/v2/*', script: 'api-v2' },
    ])
    mock.method(globalThis, 'fetch', cf.fetch)

    assert.equal(await routes(['status', 'live'], project()), 0)
    assert.match(printed(out), /app\.acme\.test\/hooks\/\* -> hooks/)
    assert.doesNotMatch(printed(out), /api-v2/)
  })

  it('status warns about narrower routes on every host of the config while serving normally', async () => {
    const cf = fakeCloudflare([{ pattern: 'api.acme.test/v2/*', script: 'api-v2' }])
    mock.method(globalThis, 'fetch', cf.fetch)

    assert.equal(await routes(['status', 'live'], project()), 0)
    assert.match(printed(out), /api\.acme\.test\/v2\/\* -> api-v2/)
  })

  for (const [title, argv, message] of [
    ['a host that the config does not have', ['on', 'live', '--host', 'www.acme.test'], /www\.acme\.test is not in the patterns of live/],
    ['--host without a value', ['on', 'live', '--host'], /--host needs a host/],
    ['--host with off', ['off', 'live', '--host', 'app.acme.test'], /--host can only be used with on/],
    ['--host with status', ['status', 'live', '--host=app.acme.test'], /--host can only be used with on/],
    ['an unknown option', ['on', 'live', '--dry-run'], /Unknown option: --dry-run/],
  ]) {
    it(`stops before calling the API for ${title}`, async () => {
      const cf = fakeCloudflare()
      const fetch = mock.method(globalThis, 'fetch', cf.fetch)

      assert.equal(await routes(argv, project()), 1)
      assert.match(printed(err), message)
      assert.equal(fetch.mock.callCount(), 0)
    })
  }
})
