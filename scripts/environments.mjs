// The Worker name and the routes to attach during maintenance, per environment.
// The zone and hosts live in maintenance.config.json. The Worker name is wrangler.jsonc's name plus the environment name.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWranglerConfig, stripBom } from './wrangler-config.mjs'

const isNonEmptyString = (value) => typeof value === 'string' && value !== ''

/**
 * Builds the environments from the config and wrangler.jsonc.
 * Mismatches and mistakes are returned per environment as problems / warnings instead of throwing,
 * so a mistake in an unrelated environment cannot block off or status in the middle of maintenance.
 */
export const buildEnvironments = (config, wrangler) => {
  if (!isNonEmptyString(config.zone)) throw new Error('zone is not set in maintenance.config.json')

  const deployed = wrangler.env ?? {}
  const environments = {}
  const problems = {}
  for (const [name, { patterns } = {}] of Object.entries(config.environments ?? {})) {
    if (!(name in deployed)) {
      problems[name] = `${name}: in maintenance.config.json but not in the env of wrangler.jsonc`
    } else if (!Array.isArray(patterns) || patterns.length === 0 || !patterns.every(isNonEmptyString)) {
      problems[name] = `${name}: patterns in maintenance.config.json must be an array of one or more patterns`
    } else {
      // When an env overrides name, wrangler deploys under that name.
      environments[name] = { script: deployed[name].name ?? `${wrangler.name}-${name}`, patterns }
    }
  }

  const warnings = Object.keys(deployed)
    .filter((name) => !(name in (config.environments ?? {})))
    .map((name) => `${name}: in the env of wrangler.jsonc but not in maintenance.config.json (its routes cannot be managed)`)

  return { zone: config.zone, environments, problems, warnings }
}

/** Reads maintenance.config.json and wrangler.jsonc in dir (the project directory; defaults to the current directory). */
export const loadEnvironments = (dir = process.cwd()) => {
  const config = JSON.parse(stripBom(readFileSync(join(dir, 'maintenance.config.json'), 'utf8')))
  return buildEnvironments(config, readWranglerConfig(dir))
}
