// The maintenance page. CSS is inlined so the page renders even while the origin is down.
// The text comes from vars (PAGE_LANG, BRAND, PAGE_TITLE, PAGE_HEADING, PAGE_MESSAGE). Edit this file to change the look.

const DEFAULT_LANG = 'en'
const DEFAULT_TITLE = 'Under maintenance'
const DEFAULT_HEADING = 'We are currently down for maintenance'
const DEFAULT_MESSAGE = 'We apologize for the inconvenience.\nPlease try again in a little while.'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ESCAPES[char])

// An empty string counts as unset, so leaving a var empty still shows the default.
// wrangler can pass numbers and booleans as vars, so values are turned into strings first.
const pick = (value, fallback) => (String(value ?? '') === '' ? fallback : String(value))

/** Builds the maintenance page HTML from the env vars. */
export const renderMaintenancePage = (env) => {
  const brand = String(env.BRAND ?? '')
  const lang = escapeHtml(pick(env.PAGE_LANG, DEFAULT_LANG))
  const baseTitle = pick(env.PAGE_TITLE, DEFAULT_TITLE)
  const title = escapeHtml(brand === '' ? baseTitle : `${baseTitle} | ${brand}`)
  const brandLine = brand === '' ? '' : `  <div class="brand">${escapeHtml(brand)}</div>\n`
  const heading = escapeHtml(pick(env.PAGE_HEADING, DEFAULT_HEADING))
  // Escape first, then turn newlines into <br>. The other way round would escape the <br> too.
  const message = escapeHtml(pick(env.PAGE_MESSAGE, DEFAULT_MESSAGE)).replace(/\r?\n/g, '<br>')

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f5f5f5; color: #1f2937; padding: 24px; box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif; }
  main { max-width: 560px; width: 100%; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
    padding: 40px 32px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  p { margin: 0; line-height: 1.8; color: #6b7280; font-size: 15px; }
  .brand { font-weight: 700; letter-spacing: 0.04em; margin-bottom: 24px; }
</style>
</head>
<body>
<main>
${brandLine}  <h1>${heading}</h1>
  <p>${message}</p>
</main>
</body>
</html>
`
}
