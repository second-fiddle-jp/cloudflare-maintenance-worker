import { bypassRedirect, shouldPassThrough } from './bypass.js'
import { renderMaintenancePage } from './page.js'

const DEFAULT_RETRY_AFTER = '3600'

/** The headers every maintenance response carries. Neither Cloudflare nor the browser may cache it. */
const maintenanceHeaders = (env) => ({ 'Cache-Control': 'no-store', 'Retry-After': String(env.RETRY_AFTER || DEFAULT_RETRY_AFTER) })

/**
 * Answers a request: the passphrase redirect, operators to the origin, everyone else the maintenance page.
 * respond holds functions that may answer instead of the page, such as a JSON error for API clients.
 * Each gets (request, env, { headers }) and returns a Response, or undefined / null to leave the request to the next one.
 * They are consulted only for requests that would get the page, never for operators.
 */
export const handle = async (request, env, upstream = fetch, respond = []) => {
  const redirect = await bypassRedirect(request, env)
  if (redirect !== null) return redirect

  if (await shouldPassThrough(request, env)) return upstream(request)

  for (const answer of respond) {
    const response = await answer(request, env, { headers: maintenanceHeaders(env) })
    if (response != null) return response
  }

  return new Response(renderMaintenancePage(env), {
    status: 503,
    headers: { ...maintenanceHeaders(env), 'Content-Type': 'text/html; charset=utf-8' },
  })
}
