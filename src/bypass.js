// Decides which requests are let through to the origin during maintenance.
// The passphrase is the Worker secret BYPASS_SECRET; allowed IPs are the secret ALLOW_IPS (comma-separated).
// With COOKIE_DOMAIN empty the cookie is host-only and does not work across subdomains.

const BYPASS_PARAM = 'maintenance_bypass'
const COOKIE_MAX_AGE = 60 * 60 * 12
const DEFAULT_COOKIE_NAME = 'maintenance_bypass'

const digest = async (value) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))

const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** Hashes both sides with SHA-256 so the lengths match, then compares in constant time. */
const safeEqual = async (a, b) => {
  const [x, y] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i]
  return diff === 0
}

const parseList = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')

/** The same name is used to issue and to check the cookie. Falls back to the default when BYPASS_COOKIE is empty. */
const cookieName = (env) => String(env.BYPASS_COOKIE || DEFAULT_COOKIE_NAME)

const readCookie = (header, name) => {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return null
}

/** The cookie value. It never contains the passphrase itself. */
export const bypassCookieValue = async (secret) => toHex(await digest(`cookie:${secret}`))

/** For a URL carrying the correct passphrase, returns a redirect to the URL without it, plus the cookie. Otherwise null. */
export const bypassRedirect = async (request, env) => {
  const secret = env.BYPASS_SECRET ?? ''
  const url = new URL(request.url)
  const given = url.searchParams.get(BYPASS_PARAM)
  if (secret === '' || given === null || !(await safeEqual(given, secret))) return null

  url.searchParams.delete(BYPASS_PARAM)
  const domain = String(env.COOKIE_DOMAIN ?? '')
  const cookie = [
    `${cookieName(env)}=${await bypassCookieValue(secret)}`,
    ...(domain === '' ? [] : [`Domain=${domain}`]),
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')

  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
  })
}

/** True for an allowed IP or a request carrying the issued cookie. */
export const shouldPassThrough = async (request, env) => {
  const ip = request.headers.get('CF-Connecting-IP')
  if (ip !== null && parseList(env.ALLOW_IPS).includes(ip)) return true

  const secret = env.BYPASS_SECRET ?? ''
  if (secret === '') return false
  const cookie = readCookie(request.headers.get('Cookie'), cookieName(env))
  return cookie !== null && (await safeEqual(cookie, await bypassCookieValue(secret)))
}
