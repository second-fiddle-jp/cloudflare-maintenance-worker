import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderMaintenancePage } from '../src/page.js'

describe('the maintenance page', () => {
  it('uses the English defaults and shows no brand when nothing is set', () => {
    const html = renderMaintenancePage({})

    assert.match(html, /<html lang="en">/)
    assert.match(html, /<title>Under maintenance<\/title>/)
    assert.match(html, /<h1>We are currently down for maintenance<\/h1>/)
    assert.match(html, /<p>We apologize for the inconvenience\.<br>Please try again in a little while\.<\/p>/)
    assert.doesNotMatch(html, /class="brand"/)
  })

  it('shows no brand when BRAND is an empty string', () => {
    const html = renderMaintenancePage({ BRAND: '' })

    assert.match(html, /<title>Under maintenance<\/title>/)
    assert.doesNotMatch(html, /class="brand"/)
  })

  it('treats empty vars as unset', () => {
    assert.equal(renderMaintenancePage({ PAGE_LANG: '', PAGE_TITLE: '', PAGE_HEADING: '', PAGE_MESSAGE: '' }), renderMaintenancePage({}))
  })

  it('treats non-string vars as strings', () => {
    const html = renderMaintenancePage({ BRAND: 2026, PAGE_HEADING: true })

    assert.match(html, /<div class="brand">2026<\/div>/)
    assert.match(html, /<h1>true<\/h1>/)
  })

  it('reflects each var on the page', () => {
    const html = renderMaintenancePage({
      PAGE_LANG: 'ja',
      BRAND: 'Acme',
      PAGE_TITLE: 'メンテナンス中',
      PAGE_HEADING: 'ただいまメンテナンス中です',
      PAGE_MESSAGE: 'ご不便をおかけします。\nしばらくお待ちください。',
    })

    assert.match(html, /<html lang="ja">/)
    assert.match(html, /<title>メンテナンス中 \| Acme<\/title>/)
    assert.match(html, /<div class="brand">Acme<\/div>/)
    assert.match(html, /<h1>ただいまメンテナンス中です<\/h1>/)
    assert.match(html, /<p>ご不便をおかけします。<br>しばらくお待ちください。<\/p>/)
  })

  it('HTML-escapes the values it inserts', () => {
    const html = renderMaintenancePage({
      PAGE_LANG: '"><script>',
      BRAND: '<script>alert(1)</script>',
      PAGE_HEADING: `A & B's "page"`,
      PAGE_MESSAGE: '<b>\n</b>',
    })

    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /<html lang="&quot;&gt;&lt;script&gt;">/)
    assert.match(html, /<div class="brand">&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/div>/)
    assert.match(html, /<title>Under maintenance \| &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/)
    assert.match(html, /<h1>A &amp; B&#39;s &quot;page&quot;<\/h1>/)
    assert.match(html, /<p>&lt;b&gt;<br>&lt;\/b&gt;<\/p>/)
  })
})
