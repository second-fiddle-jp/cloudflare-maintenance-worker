import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadEnvironments } from '../scripts/environments.mjs'
import { parseWranglerConfig, readWranglerConfig, stripComments, stripTrailingCommas } from '../scripts/wrangler-config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const config = readWranglerConfig(root)

describe('stripComments', () => {
  it('drops // line comments outside strings only', () => {
    const text = '{\n  // comment\n  "url": "https://example.com/a", // trailing\n  "q": "a\\"//b"\n}'

    assert.deepEqual(JSON.parse(stripComments(text)), { url: 'https://example.com/a', q: 'a"//b' })
  })

  it('drops /* */ block comments outside strings only, keeping line breaks', () => {
    const text = '{\n  /* a\n  block */ "a": 1,\n  "b": "/* not a comment */"\n}'

    assert.equal(stripComments(text).split('\n').length, text.split('\n').length)
    assert.deepEqual(JSON.parse(stripComments(text)), { a: 1, b: '/* not a comment */' })
  })
})

describe('stripTrailingCommas', () => {
  it('drops commas before } and ] outside strings only', () => {
    const text = '{ "a": [1, 2, ], "b": ",}", "c": { "d": 1,\n },\n}'

    assert.deepEqual(JSON.parse(stripTrailingCommas(text)), { a: [1, 2], b: ',}', c: { d: 1 } })
  })
})

describe('parseWranglerConfig', () => {
  it('accepts block comments and trailing commas', () => {
    assert.deepEqual(parseWranglerConfig('{ /* block */ "name": "m", // line\n "env": { "a": {}, }, }'), { name: 'm', env: { a: {} } })
  })

  it('accepts a leading byte order mark, as editors on Windows may write one', () => {
    assert.deepEqual(parseWranglerConfig('\uFEFF{ "name": "m" }'), { name: 'm' })
  })

  it('stops with a reason when the text is still not JSON', () => {
    assert.throws(() => parseWranglerConfig('{ "name": }'), /Cannot read wrangler\.jsonc/)
    assert.throws(() => parseWranglerConfig('{ /* open "name": "m" }'), /Cannot read wrangler\.jsonc/)
  })
})

describe('the sample wrangler.jsonc', () => {
  it('has no route / routes anywhere (a deploy alone must not start maintenance)', () => {
    const scopes = { top: config, ...Object.fromEntries(Object.entries(config.env ?? {}).map(([name, env]) => [`env.${name}`, env])) }
    for (const [scope, value] of Object.entries(scopes)) {
      assert.equal('route' in value, false, `${scope} has route`)
      assert.equal('routes' in value, false, `${scope} has routes`)
    }
  })

  it('disables workers.dev and preview URLs', () => {
    assert.equal(config.workers_dev, false)
    assert.equal(config.preview_urls, false)
  })

  it('has an env for each environment in maintenance.config.json, each with its own cookie name', () => {
    const names = Object.keys(loadEnvironments(root).environments)
    assert.deepEqual(Object.keys(config.env).sort(), [...names].sort())
    const cookies = names.map((name) => config.env[name].vars.BYPASS_COOKIE)
    assert.equal(new Set(cookies).size, names.length, cookies.join(', '))
  })

  it('turns invocation logs off (the URL contains the passphrase)', () => {
    assert.equal(config.observability.logs.invocation_logs, false)
  })
})
