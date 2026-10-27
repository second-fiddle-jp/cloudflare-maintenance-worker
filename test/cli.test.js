import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../bin/maintenance-worker.mjs', import.meta.url))

/** Runs the CLI in dir without a Cloudflare token, so nothing reaches the API. */
const run = (args, dir) => {
  const env = { ...process.env }
  delete env.CLOUDFLARE_API_TOKEN
  return spawnSync(process.execPath, [bin, ...args], { cwd: dir, env, encoding: 'utf8' })
}

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'maintenance-cli-'))
  writeFileSync(join(dir, 'wrangler.jsonc'), '{ "name": "acme-maintenance", "env": { "live": {} } }')
  writeFileSync(join(dir, 'maintenance.config.json'), '{ "zone": "acme.test", "environments": { "live": { "patterns": ["acme.test/*"] } } }')
  return dir
}

describe('maintenance-worker', () => {
  it('stops with usage for an unknown command', () => {
    const result = run(['start', 'live'], project())

    assert.equal(result.status, 1)
    assert.match(result.stderr, /usage: maintenance-worker/)
  })

  it('reads the configuration of the current directory and lists its environments in the usage', () => {
    const result = run(['on', 'nosuch'], project())

    assert.equal(result.status, 1)
    assert.match(result.stderr, /usage: <on\|off\|status> <live>/)
  })

  it('requires CLOUDFLARE_API_TOKEN before calling the API (a leading -- is skipped)', () => {
    const result = run(['--', 'status', '--', 'live'], project())

    assert.equal(result.status, 1)
    assert.match(result.stderr, /CLOUDFLARE_API_TOKEN is not set/)
  })

  it('stops deploy without an environment name before running wrangler', () => {
    const result = run(['deploy'], project())

    assert.equal(result.status, 1)
    assert.match(result.stderr, /usage: deploy <env>/)
  })
})
