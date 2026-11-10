import { describe, expect, it } from 'vitest'
import {
  classifyIPv4,
  fetchLinkMetadata,
  handleFetchLink,
  isAuthorized,
  isBlockedAddress,
  isBlockedHostname,
  parseHtmlMetadata,
  type DnsResolver,
  type FetchLike,
} from './index'

const publicDns: DnsResolver = async (hostname) => {
  if (hostname === 'example.com') return ['93.184.216.34']
  if (hostname === 'evil.test') return ['127.0.0.1']
  return []
}

describe('address blocking', () => {
  it('blocks loopback, private, and metadata hosts', () => {
    expect(classifyIPv4('8.8.8.8')).toBe('public')
    expect(classifyIPv4('127.0.0.1')).toBe('private')
    expect(classifyIPv4('10.1.2.3')).toBe('private')
    expect(classifyIPv4('172.16.0.1')).toBe('private')
    expect(classifyIPv4('172.15.0.1')).toBe('public')
    expect(classifyIPv4('192.168.1.1')).toBe('private')
    expect(classifyIPv4('169.254.169.254')).toBe('private')
    expect(classifyIPv4('127.1')).toBe('invalid')
    expect(classifyIPv4('2130706433')).toBe('invalid')
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('metadata.google.internal')).toBe(true)
    expect(isBlockedHostname('example.com')).toBe(false)
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('fe80::1')).toBe(true)
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false)
  })
})

describe('parseHtmlMetadata', () => {
  it('prefers og title and resolves a relative icon', () => {
    const html = `
      <html><head>
        <meta content="甲 &amp; 乙" property="og:title">
        <meta name="description" content="一条简介">
        <title>被忽略</title>
        <link rel="icon" href="/icon.png">
      </head></html>`
    const parsed = parseHtmlMetadata(html, 'https://example.com/post')
    expect(parsed.title).toBe('甲 & 乙')
    expect(parsed.description).toBe('一条简介')
    expect(parsed.favicon_url).toBe('https://example.com/icon.png')
  })
})

describe('fetchLinkMetadata', () => {
  it('reads html and refuses a redirect into the private network', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async (input) => {
      calls.push(input)
      if (input === 'https://example.com/') {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
      }
      return new Response('<title>不该读到</title>', { status: 200, headers: { 'content-type': 'text/html' } })
    }
    await expect(fetchLinkMetadata('https://example.com/', { fetchImpl, resolve: publicDns })).rejects.toThrow('blocked_url')
    expect(calls).toEqual(['https://example.com/'])
  })

  it('returns the title from a public page', async () => {
    const fetchImpl: FetchLike = async () => new Response(
      '<meta property="og:title" content="面馆"><meta name="description" content="附近">',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
    const preview = await fetchLinkMetadata('https://example.com/noodles', { fetchImpl, resolve: publicDns })
    expect(preview.title).toBe('面馆')
    expect(preview.description).toBe('附近')
    expect(preview.final_url).toBe('https://example.com/noodles')
  })

  it('does not fetch a hostname that resolves privately', async () => {
    let called = false
    const fetchImpl: FetchLike = async () => {
      called = true
      return new Response('', { status: 200 })
    }
    await expect(fetchLinkMetadata('https://evil.test/', { fetchImpl, resolve: publicDns })).rejects.toThrow('blocked_url')
    expect(called).toBe(false)
  })
})

describe('handleFetchLink', () => {
  it('requires the project key and answers the browser preflight', async () => {
    const env = { SUPABASE_ANON_KEY: 'anon-key' }
    expect(isAuthorized(new Request('https://example.com', { headers: { apikey: 'anon-key' } }), env)).toBe(true)
    expect(isAuthorized(new Request('https://example.com', { headers: { apikey: 'other' } }), env)).toBe(false)

    const preflight = await handleFetchLink(new Request('https://example.com', { method: 'OPTIONS' }), env)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')

    const denied = await handleFetchLink(new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    }), env)
    expect(denied.status).toBe(401)
  })
})
