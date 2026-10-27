// Deploys the Worker. Requires an environment name and runs wrangler deploy.
// Uses Node's standard API only.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { buildDeployArgs } from './deploy-args.mjs'

/** Finds wrangler's bin from the project's own dependencies first, then from this package's. */
const resolveWrangler = (dir) => {
  let manifestPath
  for (const from of [join(dir, 'package.json'), import.meta.url]) {
    try {
      manifestPath = createRequire(from).resolve('wrangler/package.json')
      break
    } catch {}
  }
  if (manifestPath === undefined) throw new Error('wrangler is not installed. Add it to devDependencies')
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return join(dirname(manifestPath), bin.wrangler)
}

/** Runs deploy and returns the exit code. dir is the project directory (where wrangler.jsonc is). */
export const deploy = (argv, dir = process.cwd()) => {
  let args
  let wrangler
  try {
    args = buildDeployArgs(argv)
    wrangler = resolveWrangler(dir)
  } catch (error) {
    console.error(error.message)
    return 1
  }

  // Run wrangler's bin with node directly. No shell is involved, so arguments pass through unchanged on Windows too.
  const result = spawnSync(process.execPath, [wrangler, ...args], { stdio: 'inherit', cwd: dir })
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}
