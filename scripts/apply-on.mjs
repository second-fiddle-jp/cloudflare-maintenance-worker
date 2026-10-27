// Attaches routes one by one for on, and decides what to tell the operator on failure. Does not talk to Cloudflare (the caller passes post).

// The Cloudflare API error code returned when attaching a route to a Worker that does not exist.
export const WORKER_NOT_FOUND = 10019

/** The Cloudflare API returned a failure. errors is the API's errors array (empty when the body was not JSON). */
export class ApiError extends Error {
  constructor(message, errors = []) {
    super(message)
    this.name = 'ApiError'
    this.errors = errors
  }
}

/** Posts each pattern in order. Stops at the first failure and returns the patterns attached so far and the error. */
export const applyOn = async ({ create, post }) => {
  const created = []
  for (const pattern of create) {
    try {
      await post(pattern)
    } catch (error) {
      return { created, error }
    }
    created.push(pattern)
  }
  return { created, error: undefined }
}

/**
 * The guidance after on fails part way. attached is the number of this Worker's routes counted from a fresh
 * route list after the failure, or undefined when the list could not be fetched. total is the number of target routes.
 * Both count only the target patterns. elsewhere is the number of this Worker's other routes, attached earlier by on --host.
 * A failed POST does not prove the route was not attached (a 502 from a proxy, for example), so the count decides.
 */
export const describeOnFailure = ({ envName, script, error, attached, total, elsewhere = 0 }) => {
  if (attached === undefined) {
    return `Some hosts may be in maintenance. Check with status ${envName} and run off ${envName} if needed`
  }
  if (attached >= total) {
    return `A failure was returned, but all ${total} routes are attached. Check with status ${envName}`
  }
  if (attached > 0) {
    return `Only some hosts are in maintenance. Check with status ${envName} and run off ${envName} if needed`
  }
  if (elsewhere > 0) {
    return `No routes were attached for the selected hosts. The ${elsewhere} routes attached earlier are still attached, so those hosts stay in maintenance. Check with status ${envName} and run off ${envName} if needed`
  }
  if (error instanceof ApiError && error.errors.some((e) => e.code === WORKER_NOT_FOUND)) {
    return `Worker ${script} has not been deployed yet. No routes were attached (still serving normally). Run deploy ${envName} first, then run on ${envName} again`
  }
  return 'No routes were attached (still serving normally)'
}
