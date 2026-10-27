import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handle } from '../src/handler.js'
import { bypassCookieValue } from '../src/bypass.js'

const env = {
  BYPASS_SECRET: 'open-sesame',
  ALLOW_IPS: '203.0.113.10, 2001:db8::1',
  BYPASS_COOKIE: 'example_maintenance_bypass',
  RETRY_AFTER: '3600',
  COOKIE_DOMAIN: '.example.com',
}

/** Stands in for the origin. Returns 200 and records each call. */
const fakeOrigin = () => {
  const calls = []
  const upstream = async (request) => {
    calls.push(request)
    return new Response('origin', { status: 200 })
  }
  return { calls, upstream }
}

describe('the maintenance response', () => {
  it('returns 503 and the maintenance page for normal requests without reaching the origin', async () => {
    const { calls, upstream } = fakeOrigin()
    const res = await handle(new Request('https://example.com/jobs'), env, upstream)

    assert.equal(res.status, 503)
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    assert.equal(res.headers.get('Retry-After'), '3600')
    assert.match(await res.text(), /Under maintenance/)
    assert.equal(calls.length, 0)
  })

  it('returns the HTML 503 to Inertia visits and API hosts alike when nothing is plugged in', async () => {
    const { upstream } = fakeOrigin()
    const inertia = await handle(new Request('https://app.example.com/jobs', { headers: { 'X-Inertia': 'true' } }), env, upstream)
    const api = await handle(new Request('https://api.example.com/rpc', { method: 'POST', body: '{}' }), env, upstream)

    for (const res of [inertia, api]) {
      assert.equal(res.status, 503)
      assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8')
    }
  })
})

describe('custom responses (respond)', () => {
  const json = (request) =>
    new URL(request.url).hostname === 'api.example.com' ? new Response('{}', { status: 503 }) : undefined

  it('returns the first Response a function gives', async () => {
    const { upstream } = fakeOrigin()
    const res = await handle(new Request('https://api.example.com/rpc'), env, upstream, [json])

    assert.equal(res.status, 503)
    assert.equal(await res.text(), '{}')
  })

  it('moves on to the next function, then to the page, when a function gives undefined or null', async () => {
    const { upstream } = fakeOrigin()
    const seen = []
    const skip = (request) => {
      seen.push(new URL(request.url).hostname)
      return null
    }
    const page = await handle(new Request('https://example.com/'), env, upstream, [skip, json])
    const custom = await handle(new Request('https://api.example.com/rpc'), env, upstream, [skip, json])

    assert.deepEqual(seen, ['example.com', 'api.example.com'])
    assert.equal(page.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.equal(await custom.text(), '{}')
  })

  it('awaits functions that return a promise', async () => {
    const { upstream } = fakeOrigin()
    const res = await handle(new Request('https://example.com/'), env, upstream, [async () => new Response('later', { status: 503 })])

    assert.equal(await res.text(), 'later')
  })

  it('passes env and the headers the page uses (Cache-Control and Retry-After)', async () => {
    const { upstream } = fakeOrigin()
    let received
    const spy = (request, givenEnv, context) => {
      received = { givenEnv, context }
    }
    await handle(new Request('https://example.com/'), { ...env, RETRY_AFTER: '120' }, upstream, [spy])

    assert.equal(received.givenEnv.RETRY_AFTER, '120')
    assert.deepEqual(received.context.headers, { 'Cache-Control': 'no-store', 'Retry-After': '120' })
  })

  it('is not consulted for operators, the passphrase redirect or allowed IPs', async () => {
    const { calls, upstream } = fakeOrigin()
    let called = 0
    const respond = [() => {
      called++
      return new Response('custom')
    }]
    const value = await bypassCookieValue('open-sesame')
    const redirect = await handle(new Request('https://example.com/?maintenance_bypass=open-sesame'), env, upstream, respond)
    const viaCookie = await handle(
      new Request('https://example.com/', { headers: { Cookie: `example_maintenance_bypass=${value}` } }),
      env,
      upstream,
      respond,
    )
    const viaIp = await handle(new Request('https://example.com/', { headers: { 'CF-Connecting-IP': '203.0.113.10' } }), env, upstream, respond)

    assert.equal(redirect.status, 302)
    assert.equal(viaCookie.status, 200)
    assert.equal(viaIp.status, 200)
    assert.equal(calls.length, 2)
    assert.equal(called, 0)
  })
})

describe('letting operators through', () => {
  it('forwards requests from an allowed IP to the origin as is', async () => {
    const { calls, upstream } = fakeOrigin()
    const req = new Request('https://example.com/', { headers: { 'CF-Connecting-IP': '2001:db8::1' } })
    const res = await handle(req, env, upstream)

    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0], req)
  })

  it('does not let other IPs through', async () => {
    const { calls, upstream } = fakeOrigin()
    const req = new Request('https://example.com/', { headers: { 'CF-Connecting-IP': '203.0.113.11' } })
    const res = await handle(req, env, upstream)

    assert.equal(res.status, 503)
    assert.equal(calls.length, 0)
  })

  it('with the right passphrase, redirects 302 to the URL without the parameter and issues the cookie', async () => {
    const { calls, upstream } = fakeOrigin()
    const req = new Request('https://app.example.com/jobs?maintenance_bypass=open-sesame&page=2')
    const res = await handle(req, env, upstream)

    assert.equal(res.status, 302)
    assert.equal(res.headers.get('Location'), 'https://app.example.com/jobs?page=2')
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    const cookie = res.headers.get('Set-Cookie')
    assert.equal(
      cookie,
      `example_maintenance_bypass=${await bypassCookieValue('open-sesame')}; Domain=.example.com; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`,
    )
    assert.equal(calls.length, 0)
  })

  it('issues a cookie without Domain when COOKIE_DOMAIN is unset or empty', async () => {
    const { upstream } = fakeOrigin()
    const { COOKIE_DOMAIN: _unused, ...envWithoutDomain } = env
    const value = await bypassCookieValue('open-sesame')
    const expected = `example_maintenance_bypass=${value}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`

    for (const target of [envWithoutDomain, { ...env, COOKIE_DOMAIN: '' }]) {
      const res = await handle(new Request('https://example.com/?maintenance_bypass=open-sesame'), target, upstream)
      assert.equal(res.headers.get('Set-Cookie'), expected)
    }
  })

  it('returns 503 regardless of IP without the cookie when ALLOW_IPS is unset', async () => {
    const { calls, upstream } = fakeOrigin()
    const { ALLOW_IPS: _unused, ...envWithoutAllowIps } = env
    const req = new Request('https://example.com/', { headers: { 'CF-Connecting-IP': '203.0.113.10' } })
    const res = await handle(req, envWithoutAllowIps, upstream)

    assert.equal(res.status, 503)
    assert.equal(calls.length, 0)
  })

  it('returns 503 without a cookie for a wrong passphrase', async () => {
    const { upstream } = fakeOrigin()
    const res = await handle(new Request('https://example.com/?maintenance_bypass=wrong'), env, upstream)

    assert.equal(res.status, 503)
    assert.equal(res.headers.get('Set-Cookie'), null)
  })

  it('forwards requests carrying the issued cookie to the origin', async () => {
    const { calls, upstream } = fakeOrigin()
    const value = await bypassCookieValue('open-sesame')
    const req = new Request('https://admin.example.com/', {
      headers: { Cookie: `other=1; example_maintenance_bypass=${value}` },
    })
    const res = await handle(req, env, upstream)

    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
  })

  it('does not let a cookie with a different value through', async () => {
    const { calls, upstream } = fakeOrigin()
    const req = new Request('https://example.com/', { headers: { Cookie: 'example_maintenance_bypass=forged' } })
    const res = await handle(req, env, upstream)

    assert.equal(res.status, 503)
    assert.equal(calls.length, 0)
  })

  it('does not let a cookie with another environment name through', async () => {
    const { calls, upstream } = fakeOrigin()
    const value = await bypassCookieValue('open-sesame')
    const req = new Request('https://example.com/', { headers: { Cookie: `example_maintenance_bypass_dev=${value}` } })
    await handle(req, env, upstream)

    assert.equal(calls.length, 0)
  })

  it('neither the passphrase nor the cookie works when BYPASS_SECRET is empty', async () => {
    const { calls, upstream } = fakeOrigin()
    const noSecret = { ...env, BYPASS_SECRET: '' }
    const value = await bypassCookieValue('')
    const viaParam = await handle(new Request('https://example.com/?maintenance_bypass='), noSecret, upstream)
    const viaCookie = await handle(
      new Request('https://example.com/', { headers: { Cookie: `example_maintenance_bypass=${value}` } }),
      noSecret,
      upstream,
    )

    assert.equal(viaParam.status, 503)
    assert.equal(viaCookie.status, 503)
    assert.equal(calls.length, 0)
  })
})

describe('non-string vars', () => {
  it('puts a numeric RETRY_AFTER into Retry-After', async () => {
    const { upstream } = fakeOrigin()
    const res = await handle(new Request('https://example.com/'), { ...env, RETRY_AFTER: 120 }, upstream)

    assert.equal(res.headers.get('Retry-After'), '120')
  })
})

describe('var defaults', () => {
  it('Retry-After is 3600 when RETRY_AFTER is unset', async () => {
    const { upstream } = fakeOrigin()
    const { RETRY_AFTER: _unused, ...withoutRetryAfter } = env
    const res = await handle(new Request('https://example.com/'), withoutRetryAfter, upstream)

    assert.equal(res.headers.get('Retry-After'), '3600')
  })

  it('issues and accepts the cookie named maintenance_bypass when BYPASS_COOKIE is unset', async () => {
    const { calls, upstream } = fakeOrigin()
    const { BYPASS_COOKIE: _unused, ...withoutCookieName } = env
    const redirect = await handle(new Request('https://example.com/?maintenance_bypass=open-sesame'), withoutCookieName, upstream)
    const value = await bypassCookieValue('open-sesame')
    const res = await handle(
      new Request('https://example.com/', { headers: { Cookie: `maintenance_bypass=${value}` } }),
      withoutCookieName,
      upstream,
    )

    assert.match(redirect.headers.get('Set-Cookie'), new RegExp(`^maintenance_bypass=${value};`))
    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
  })
})
