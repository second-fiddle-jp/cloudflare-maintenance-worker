// Builds the wrangler arguments from the arguments given to deploy. Does not run wrangler.

export const DEPLOY_USAGE = 'usage: deploy <env> [wrangler deploy options]'

/**
 * Passes the first argument to --env as the environment name and appends the rest as is.
 * A leading -- is skipped (pnpm passes it through for pnpm run deploy -- <env>).
 * Throws when the environment name is missing, empty or an option: plain wrangler deploy and --env ""
 * would create a Worker without vars. wrangler itself checks that the name exists in wrangler.jsonc.
 */
export const buildDeployArgs = (argv) => {
  const [envName, ...rest] = argv[0] === '--' ? argv.slice(1) : argv
  if (envName === undefined || envName === '' || envName.startsWith('-')) throw new Error(DEPLOY_USAGE)
  return ['deploy', '--env', envName, ...rest]
}
