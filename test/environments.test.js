import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildEnvironments, loadEnvironments } from '../scripts/environments.mjs'
import { readWranglerConfig } from '../scripts/wrangler-config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('the sample configuration', () => {
  it('maintenance.config.json matches the env of wrangler.jsonc with no problems or warnings', () => {
    const loaded = loadEnvironments(root)

    assert.deepEqual(Object.keys(loaded.environments).sort(), Object.keys(readWranglerConfig(root).env).sort())
    assert.deepEqual(loaded.problems, {})
    assert.deepEqual(loaded.warnings, [])
    assert.equal(loaded.zone, 'example.com')
  })
})

describe('loadEnvironments', () => {
  it('reads the configuration from the given directory, not from this package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintenance-'))
    writeFileSync(join(dir, 'wrangler.jsonc'), '{ "name": "other", "env": { "live": {}, }, }')
    writeFileSync(join(dir, 'maintenance.config.json'), '{ "zone": "other.test", "environments": { "live": { "patterns": ["other.test/*"] } } }')

    assert.deepEqual(loadEnvironments(dir).environments, { live: { script: 'other-live', patterns: ['other.test/*'] } })
  })

  it('accepts a leading byte order mark in both files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maintenance-'))
    writeFileSync(join(dir, 'wrangler.jsonc'), '\uFEFF{ "name": "other", "env": { "live": {} } }')
    writeFileSync(join(dir, 'maintenance.config.json'), '\uFEFF{ "zone": "other.test", "environments": { "live": { "patterns": ["other.test/*"] } } }')

    assert.deepEqual(loadEnvironments(dir).environments, { live: { script: 'other-live', patterns: ['other.test/*'] } })
  })
})

describe('buildEnvironments', () => {
  const wranglerConfig = { name: 'example-maintenance', env: { develop: {}, production: {} } }
  const valid = { zone: 'example.com', environments: { develop: { patterns: ['dev.example.com/*'] }, production: { patterns: ['example.com/*'] } } }

  it('builds zone and environments from the config and the wrangler name', () => {
    assert.deepEqual(buildEnvironments(valid, wranglerConfig), {
      zone: 'example.com',
      environments: {
        develop: { script: 'example-maintenance-develop', patterns: ['dev.example.com/*'] },
        production: { script: 'example-maintenance-production', patterns: ['example.com/*'] },
      },
      problems: {},
      warnings: [],
    })
  })

  it('uses the name an env overrides as the Worker name', () => {
    const renamed = { name: 'example-maintenance', env: { develop: { name: 'dev-maint' }, production: {} } }

    assert.equal(buildEnvironments(valid, renamed).environments.develop.script, 'dev-maint')
  })

  it('reports an environment missing from wrangler.jsonc as a problem for that environment only', () => {
    const withStaging = { ...valid, environments: { ...valid.environments, staging: { patterns: ['staging.example.com/*'] } } }
    const result = buildEnvironments(withStaging, wranglerConfig)

    assert.match(result.problems.staging, /wrangler\.jsonc/)
    assert.equal(result.environments.staging, undefined)
    assert.deepEqual(Object.keys(result.environments), ['develop', 'production'])
  })

  it('keeps the other environments usable and only warns when wrangler.jsonc has an env missing from the config', () => {
    const extra = { ...wranglerConfig, env: { ...wranglerConfig.env, preview: {} } }
    const result = buildEnvironments(valid, extra)

    assert.deepEqual(Object.keys(result.environments), ['develop', 'production'])
    assert.deepEqual(result.problems, {})
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0], /preview/)
  })

  it('reports environments whose patterns are missing, empty or not strings as problems', () => {
    const broken = {
      zone: 'example.com',
      environments: { develop: {}, production: { patterns: [] }, staging: { patterns: [''] } },
    }
    const result = buildEnvironments(broken, { name: 'm', env: { develop: {}, production: {}, staging: {} } })

    assert.deepEqual(Object.keys(result.problems).sort(), ['develop', 'production', 'staging'])
    assert.deepEqual(result.environments, {})
  })

  it('stops when zone is empty, since no environment can be used', () => {
    assert.throws(() => buildEnvironments({ ...valid, zone: '' }, wranglerConfig), /zone/)
    assert.throws(() => buildEnvironments({ environments: valid.environments }, wranglerConfig), /zone/)
  })
})
