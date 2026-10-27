import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildDeployArgs } from '../scripts/deploy-args.mjs'

describe('buildDeployArgs', () => {
  it('passes the environment name to --env', () => {
    assert.deepEqual(buildDeployArgs(['develop']), ['deploy', '--env', 'develop'])
  })

  it('passes arguments after the environment name to wrangler as is', () => {
    assert.deepEqual(buildDeployArgs(['develop', '--dry-run']), ['deploy', '--env', 'develop', '--dry-run'])
  })

  it('skips a leading -- (pnpm run deploy -- develop)', () => {
    assert.deepEqual(buildDeployArgs(['--', 'develop', '--dry-run']), ['deploy', '--env', 'develop', '--dry-run'])
  })

  // Plain wrangler deploy and --env "" would create a Worker without vars
  it('stops without an environment name', () => {
    assert.throws(() => buildDeployArgs([]), /usage: .*deploy <env>/)
  })

  it('stops on an empty environment name (an unset variable was passed)', () => {
    assert.throws(() => buildDeployArgs(['']), /usage: .*deploy <env>/)
  })

  it('stops when nothing follows --', () => {
    assert.throws(() => buildDeployArgs(['--']), /usage: .*deploy <env>/)
  })

  it('stops when an option comes instead of the environment name', () => {
    assert.throws(() => buildDeployArgs(['--dry-run']), /usage: .*deploy <env>/)
  })
})
