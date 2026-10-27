// Reads wrangler.jsonc into plain JSON with Node's standard API only (no dependency on wrangler).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Walks text, calling onOutside for each character outside a string; string contents are copied as is. */
const scan = (text, onOutside) => {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
      out += ch
    } else {
      const result = onOutside(text, i)
      out += result.text
      i = result.next - 1
    }
  }
  return out
}

/** Drops // line comments and /* *\/ block comments outside strings. */
export const stripComments = (text) =>
  scan(text, (s, i) => {
    if (s[i] === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i)
      return { text: '\n', next: end === -1 ? s.length : end + 1 }
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      if (end === -1) throw new Error('unterminated block comment')
      // Keep the newlines so JSON.parse still reports useful line numbers.
      return { text: s.slice(i, end + 2).replace(/[^\n]/g, ''), next: end + 2 }
    }
    return { text: s[i], next: i + 1 }
  })

/** Drops a comma that is followed only by whitespace and a closing } or ]. Run after stripComments. */
export const stripTrailingCommas = (text) =>
  scan(text, (s, i) => {
    if (s[i] === ',' && /^\s*[}\]]/.test(s.slice(i + 1))) return { text: '', next: i + 1 }
    return { text: s[i], next: i + 1 }
  })

/** Drops a leading byte order mark, which some editors on Windows write and JSON.parse rejects. */
export const stripBom = (text) => text.replace(/^\uFEFF/, '')

/** Parses the contents of wrangler.jsonc. Accepts // and /* *\/ comments and trailing commas, as wrangler does. */
export const parseWranglerConfig = (text) => {
  try {
    return JSON.parse(stripTrailingCommas(stripComments(stripBom(text))))
  } catch (error) {
    throw new Error(`Cannot read wrangler.jsonc: ${error.message}`)
  }
}

/** Reads wrangler.jsonc in dir (the project directory; defaults to the current directory). */
export const readWranglerConfig = (dir = process.cwd()) => parseWranglerConfig(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'))
