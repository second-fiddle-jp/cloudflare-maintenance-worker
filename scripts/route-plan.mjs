// Decides which routes on / off create and delete. Does not talk to Cloudflare.

/** Creates only the patterns that do not exist yet. A pattern held by another Worker is returned in conflicts. */
export const planOn = (existing, { script, patterns }) => {
  const conflicts = existing.filter((route) => patterns.includes(route.pattern) && route.script !== script)
  const taken = new Set(existing.filter((route) => patterns.includes(route.pattern)).map((route) => route.pattern))
  return { create: patterns.filter((pattern) => !taken.has(pattern)), conflicts }
}

/** Returns only this maintenance Worker's routes. Routes of other Workers are never touched. */
export const planOff = (existing, { script }) => existing.filter((route) => route.script === script)

/** Routes of other Workers on the target hosts. Those paths keep serving during maintenance, so they are warned about. */
export const findShadowingRoutes = (existing, { script, patterns }) => {
  const hosts = new Set(patterns.map(hostOf))
  return existing.filter((route) => route.script !== script && hosts.has(hostOf(route.pattern)))
}

const hostOf = (pattern) => pattern.split('/')[0]

/** Keeps the patterns whose host is one of hosts, in the order of the config. Hosts that no pattern has are returned in unknown. */
export const selectHosts = (patterns, hosts) => ({
  patterns: patterns.filter((pattern) => hosts.includes(hostOf(pattern))),
  unknown: hosts.filter((host) => !patterns.some((pattern) => hostOf(pattern) === host)),
})
