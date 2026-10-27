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
  const hosts = new Set(patterns.map((pattern) => pattern.split('/')[0]))
  return existing.filter((route) => route.script !== script && hosts.has(route.pattern.split('/')[0]))
}
