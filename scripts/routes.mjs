// Attaches and detaches the maintenance Worker's routes. The site is in maintenance while the routes are attached.
// The API token comes from the CLOUDFLARE_API_TOKEN environment variable (Zone: Workers Routes Edit / Zone Read).
// Uses Node's standard API only.

import { loadEnvironments } from './environments.mjs'
import { ApiError, applyOn, describeOnFailure } from './apply-on.mjs'
import { findShadowingRoutes, planOff, planOn, selectHosts } from './route-plan.mjs'

const API = 'https://api.cloudflare.com/client/v4'

class Failure extends Error {}

const fail = (message) => {
  throw new Failure(message)
}

/**
 * Splits the options after the environment name. Only --host <host> / --host=<host> exists, and it may be repeated.
 * Returns the hosts, or the reason the options cannot be used.
 */
export const parseOptions = (options) => {
  const hosts = []
  for (let i = 0; i < options.length; i++) {
    const option = options[i]
    if (option === '--host') {
      const host = options[++i]
      if (host === undefined || host === '' || host.startsWith('-')) return { error: '--host needs a host, such as --host app.example.com' }
      hosts.push(host)
    } else if (option.startsWith('--host=')) {
      const host = option.slice('--host='.length)
      if (host === '') return { error: '--host needs a host, such as --host app.example.com' }
      hosts.push(host)
    } else {
      return { error: `Unknown option: ${option}` }
    }
  }
  return { hosts }
}

/**
 * Runs on / off / status and returns the exit code.
 * argv is [command, env, ...options]; a -- anywhere is skipped (pnpm passes it through for pnpm run on -- <env>).
 * on --host <host> attaches only the patterns of that host; off always detaches every route of this Worker.
 * dir is the project directory (where maintenance.config.json and wrangler.jsonc are).
 */
export const routes = async (argv, dir = process.cwd()) => {
  try {
    await run(argv, dir)
    return 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}

const run = async (argv, dir) => {
  const { zone: zoneName, environments, problems, warnings } = loadEnvironments(dir)
  for (const warning of warnings) console.error(`[warn] ${warning}`)

  const [command, envName, ...options] = argv.filter((arg) => arg !== '--')
  if (problems[envName] !== undefined) fail(`${envName} cannot be operated on because of a configuration error:\n  ${problems[envName]}`)
  const target = environments[envName]
  const usage = `usage: <on|off|status> <${Object.keys(environments).join('|')}> [--host <host> ...]`
  if (!['on', 'off', 'status'].includes(command) || target === undefined) fail(usage)

  const { hosts, error: optionError } = parseOptions(options)
  if (optionError !== undefined) fail(`${optionError}\n${usage}`)
  if (hosts.length > 0 && command !== 'on') fail(`--host can only be used with on. off always detaches every route of ${target.script}.\n${usage}`)
  const selected = selectHosts(target.patterns, hosts)
  if (selected.unknown.length > 0) {
    fail(`${selected.unknown.join(', ')} is not in the patterns of ${envName} in maintenance.config.json:\n${target.patterns.map((p) => `  ${p}`).join('\n')}`)
  }
  // The routes on attaches: every pattern, or only those of the hosts given with --host.
  const onTarget = hosts.length > 0 ? { ...target, patterns: selected.patterns } : target

  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) fail('CLOUDFLARE_API_TOKEN is not set (see the README)')

  const api = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const isJson = (res.headers.get('content-type') ?? '').includes('json')
    const json = isJson ? await res.json().catch(() => undefined) : undefined
    if (!res.ok || json === undefined) {
      const detail = json === undefined ? '' : ` ${JSON.stringify(json.errors)}`
      throw new ApiError(`${method} ${path} failed: HTTP ${res.status}${detail}`, json?.errors ?? [])
    }
    if (!json.success) throw new ApiError(`${method} ${path} failed: ${JSON.stringify(json.errors)}`, json.errors ?? [])
    return json.result
  }

  const zones = await api('GET', `/zones?name=${encodeURIComponent(zoneName)}`)
  if (zones.length === 0) fail(`Zone ${zoneName} not found (check the token's Zone Read permission)`)
  const zoneId = zones[0].id
  const listRoutes = () => api('GET', `/zones/${zoneId}/workers/routes`)

  const printStatus = async () => {
    const all = await listRoutes()
    const ours = planOff(all, target)
    // While in maintenance, narrower routes matter only on the hosts that are in it. While serving normally, check every host as a preflight.
    const watched = ours.length > 0 ? { ...target, patterns: ours.map((route) => route.pattern) } : target
    const shadowing = findShadowingRoutes(all, watched)
    if (shadowing.length > 0) {
      console.log('[warn] These routes belong to other Workers and keep serving during maintenance:')
      for (const route of shadowing) console.log(`  ${route.pattern} -> ${route.script}`)
    }
    if (ours.length === 0) {
      console.log(`[${envName}] No maintenance routes (serving normally)`)
      return
    }
    console.log(`[${envName}] In maintenance: ${ours.length} / ${target.patterns.length} routes`)
    for (const route of ours) console.log(`  ${route.pattern} -> ${route.script}`)
  }

  if (command === 'on') {
    const existing = await listRoutes()
    const { create, conflicts } = planOn(existing, onTarget)
    if (conflicts.length > 0) {
      fail(`Another Worker holds the same routes. Nothing was changed:\n${conflicts.map((r) => `  ${r.pattern} -> ${r.script}`).join('\n')}`)
    }
    const { error } = await applyOn({
      create,
      post: async (pattern) => {
        await api('POST', `/zones/${zoneId}/workers/routes`, { pattern, script: onTarget.script })
        console.log(`[add] ${pattern}`)
      },
    })
    if (error !== undefined) {
      // A failure response may still have attached the route, so count from a fresh list. If that fails too, treat it as unknown.
      // With --host, count only the patterns this on tried to attach and report routes attached earlier separately.
      // Without --host, count every route of this Worker, as before.
      const counts = await listRoutes().then(
        (all) => {
          const ours = planOff(all, onTarget)
          if (hosts.length === 0) return { attached: ours.length }
          const attached = ours.filter((route) => onTarget.patterns.includes(route.pattern)).length
          return { attached, elsewhere: ours.length - attached }
        },
        () => ({ attached: undefined }),
      )
      fail(`${error.message}\n${describeOnFailure({ envName, script: onTarget.script, error, total: onTarget.patterns.length, ...counts })}`)
    }
  } else if (command === 'off') {
    for (const route of planOff(await listRoutes(), target)) {
      await api('DELETE', `/zones/${zoneId}/workers/routes/${route.id}`)
      console.log(`[remove] ${route.pattern}`)
    }
  }

  await printStatus()
}
