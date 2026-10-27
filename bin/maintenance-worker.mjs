#!/usr/bin/env node
// maintenance-worker <deploy|on|off|status> <env> [...]
// Run it in the project directory that holds wrangler.jsonc and maintenance.config.json
// (pnpm run sets the current directory to the package that defines the script).

import { deploy } from '../scripts/deploy.mjs'
import { routes } from '../scripts/routes.mjs'

const USAGE = 'usage: maintenance-worker deploy <env> [wrangler deploy options]\n       maintenance-worker <on|off|status> <env> [--host <host> ...]'

// pnpm run on -- <env> passes the -- through, so it may come before the command name too
const argv = process.argv.slice(2)
const [command, ...rest] = argv[0] === '--' ? argv.slice(1) : argv

// Set exitCode instead of calling process.exit, so output piped to another command is flushed before the process ends.
if (command === 'deploy') {
  process.exitCode = deploy(rest)
} else if (['on', 'off', 'status'].includes(command)) {
  process.exitCode = await routes([command, ...rest])
} else {
  console.error(USAGE)
  process.exitCode = 1
}
