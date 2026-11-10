// 读取网页标题、简介和图标。浏览器直接请求别人的网站会被 CORS 拦住，
// 所以由这个 Edge Function 在服务端代为打开。
//
// 部署：函数名必须是 fetch-link。
// 控制台创建时请关闭 Enforce JWT；命令行用 --no-verify-jwt。
// 函数仍会核对 apikey，只有带本项目 anon / publishable key 的请求能用。

export class LinkError extends Error {
  readonly code: 'invalid_url' | 'blocked_url' | 'fetch_failed' | 'too_large'
  constructor(code: 'invalid_url' | 'blocked_url' | 'fetch_failed' | 'too_large') {
    super(code)
    this.name = 'LinkError'
    this.code = code
  }
}

export interface LinkPreview {
  title: string
  description: string
  favicon_url: string | null
  final_url: string
}

export type DnsRecord = 'A' | 'AAAA'
export type DnsResolver = (hostname: string, record: DnsRecord) => Promise<string[]>
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const MAX_BYTES = 500_000
const MAX_REDIRECTS = 3
const USER_AGENT = 'Mozilla/5.0 (compatible; VoteSiteLinkPreview/1.0; +https://github.com/guiboyuan705-dot/vote-site)'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Ipv4Kind = 'no' | 'public' | 'private' | 'invalid'

export function classifyIPv4(host: string): Ipv4Kind {
  if (!/^\d+(\.\d+){0,3}$/.test(host)) return 'no'
  const parts = host.split('.')
  if (parts.length !== 4) return 'invalid'
  const nums: number[] = []
  for (const part of parts) {
    if (part.length > 1 && part.startsWith('0')) return 'invalid'
    if (!/^\d+$/.test(part)) return 'invalid'
    const value = Number(part)
    if (!Number.isInteger(value) || value > 255) return 'invalid'
    nums.push(value)
  }
  return isPrivateIPv4(nums) ? 'private' : 'public'
}

function isPrivateIPv4(nums: number[]): boolean {
  const [a, b, c] = nums
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && c === 2) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function expandIPv6(host: string): string | null {
  let value = host.toLowerCase()
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':')
    const v4 = value.slice(lastColon + 1)
    const kind = classifyIPv4(v4)
    if (kind !== 'public' && kind !== 'private') return null
    const [a, b, c, d] = v4.split('.').map(Number)
    const hi = ((a << 8) | b).toString(16)
    const lo = ((c << 8) | d).toString(16)
    value = `${value.slice(0, lastColon)}:${hi}:${lo}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - (left.length + right.length)
  if (missing < 0) return null
  const parts = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right]
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  return parts.map((part) => part.padStart(4, '0')).join(':')
}

export function isBlockedIPv6(host: string): boolean {
  const full = expandIPv6(host)
  if (!full) return true
  if (
    full === '0000:0000:0000:0000:0000:0000:0000:0001' ||
    full === '0000:0000:0000:0000:0000:0000:0000:0000'
  ) {
    return true
  }
  if (full.startsWith('fc') || full.startsWith('fd') || full.startsWith('ff')) return true
  if (/^fe[89ab]/.test(full)) return true
  if (full.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const groups = full.split(':')
    const hi = Number.parseInt(groups[6], 16)
    const lo = Number.parseInt(groups[7], 16)
    const mapped = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
    return classifyIPv4(mapped) !== 'public'
  }
  return false
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
}

export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (!host) return true
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true
  }
  const v4 = classifyIPv4(host)
  if (v4 === 'private' || v4 === 'invalid') return true
  if (v4 === 'public') return false
  if (host.includes(':')) return isBlockedIPv6(host)
  return false
}

export function isBlockedAddress(ip: string): boolean {
  const host = normalizeHost(ip)
  const v4 = classifyIPv4(host)
  if (v4 === 'public') return false
  if (v4 === 'private' || v4 === 'invalid') return true
  if (host.includes(':')) return isBlockedIPv6(host)
  return true
}

async function assertPublicUrl(raw: string, resolve: DnsResolver): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new LinkError('invalid_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new LinkError('invalid_url')
  if (url.username || url.password) throw new LinkError('invalid_url')
  if (url.href.length > 2000) throw new LinkError('invalid_url')
  const host = normalizeHost(url.hostname)
  if (isBlockedHostname(host)) throw new LinkError('blocked_url')
  const v4 = classifyIPv4(host)
  if (v4 === 'public' || host.includes(':')) return url

  let ips: string[] = []
  try {
    const [v4s, v6s] = await Promise.all([
      resolve(host, 'A').catch(() => [] as string[]),
      resolve(host, 'AAAA').catch(() => [] as string[]),
    ])
    ips = [...v4s, ...v6s]
  } catch {
    ips = []
  }
  if (ips.length === 0 || ips.some((ip) => isBlockedAddress(ip))) {
    throw new LinkError('blocked_url')
  }
  return url
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return all
      try {
        return String.fromCodePoint(code)
      } catch {
        return all
      }
    }
    return named[body.toLowerCase()] ?? all
  })
}

export function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([:@\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  for (const match of tag.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

function metaContent(html: string, keys: string[]): string {
  const tags = html.match(/<meta\s[^>]*>/gi) ?? []
  for (const key of keys) {
    for (const tag of tags) {
      const attrs = parseAttrs(tag)
      const name = (attrs.property || attrs.name || '').toLowerCase()
      if (name === key && attrs.content) {
        const text = cleanText(attrs.content)
        if (text) return text
      }
    }
  }
  return ''
}

function iconHref(html: string): string | null {
  const tags = html.match(/<link\s[^>]*>/gi) ?? []
  let best: { score: number; href: string } | null = null
  for (const tag of tags) {
    const attrs = parseAttrs(tag)
    const href = attrs.href
    if (!href) continue
    const rel = (attrs.rel || '').toLowerCase().split(/\s+/)
    let score = 0
    if (rel.includes('icon')) score = 3
    else if (rel.includes('shortcut')) score = 2
    else if (rel.includes('apple-touch-icon')) score = 1
    if (score === 0) continue
    if (!best || score > best.score) best = { score, href }
  }
  return best?.href ?? null
}

function absoluteHttp(href: string, base: string): string | null {
  try {
    const url = new URL(href, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function parseHtmlMetadata(html: string, pageUrl: string): Pick<LinkPreview, 'title' | 'description' | 'favicon_url'> {
  const page = new URL(pageUrl)
  const host = page.hostname.replace(/^www\./, '')
  const ogTitle = metaContent(html, ['og:title', 'twitter:title'])
  const titleTag = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''))
  const title = (ogTitle || titleTag || host).slice(0, 300)
  const description = metaContent(html, ['og:description', 'description']).slice(0, 500)
  const icon = iconHref(html)
  const favicon = (icon ? absoluteHttp(icon, pageUrl) : null) ?? absoluteHttp('/favicon.ico', pageUrl)
  return { title, description, favicon_url: favicon }
}

function charsetFrom(contentType: string, sniff: string): string {
  const header = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)
  if (header?.[1]) return header[1].toLowerCase()
  const meta = /charset\s*=\s*["']?\s*([a-z0-9._-]+)/i.exec(sniff)
  return meta?.[1]?.toLowerCase() ?? 'utf-8'
}

function decodeBytes(bytes: Uint8Array, contentType: string): string {
  const sniff = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 4096))
  const charset = charsetFrom(contentType, sniff).replace('gb2312', 'gbk')
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new LinkError('too_large')
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new LinkError('too_large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function previewFromResponse(response: Response, pageUrl: URL): Promise<LinkPreview> {
  const type = (response.headers.get('content-type') || '').toLowerCase()
  const host = pageUrl.hostname.replace(/^www\./, '')
  const fallbackIcon = absoluteHttp('/favicon.ico', pageUrl.toString())
  if (type && !type.includes('html') && !type.includes('xml') && !type.startsWith('text/plain')) {
    return { title: host, description: '', favicon_url: fallbackIcon, final_url: pageUrl.toString() }
  }
  const bytes = await readLimited(response)
  const html = decodeBytes(bytes, type)
  const parsed = parseHtmlMetadata(html, pageUrl.toString())
  return { ...parsed, final_url: pageUrl.toString() }
}

export async function fetchLinkMetadata(
  rawUrl: string,
  deps?: { fetchImpl?: FetchLike; resolve?: DnsResolver; timeoutMs?: number },
): Promise<LinkPreview> {
  const fetchImpl = deps?.fetchImpl ?? fetch
  const resolve = deps?.resolve
  if (!resolve) throw new LinkError('blocked_url')
  let current = await assertPublicUrl(rawUrl, resolve)
  const timeoutMs = deps?.timeoutMs ?? 8000

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response
    try {
      response = await fetchImpl(current.toString(), {
        redirect: 'manual',
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'user-agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new LinkError('fetch_failed')
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new LinkError('fetch_failed')
      current = await assertPublicUrl(new URL(location, current).toString(), resolve)
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel()
      throw new LinkError('fetch_failed')
    }
    return previewFromResponse(response, current)
  }

  throw new LinkError('fetch_failed')
}

export function projectKeys(env: { SUPABASE_ANON_KEY?: string; SUPABASE_PUBLISHABLE_KEYS?: string }): string[] {
  const keys: string[] = []
  if (env.SUPABASE_ANON_KEY) keys.push(env.SUPABASE_ANON_KEY)
  if (env.SUPABASE_PUBLISHABLE_KEYS) {
    try {
      const parsed = JSON.parse(env.SUPABASE_PUBLISHABLE_KEYS) as unknown
      if (parsed && typeof parsed === 'object') {
        for (const value of Object.values(parsed as Record<string, unknown>)) {
          if (typeof value === 'string' && value) keys.push(value)
        }
      }
    } catch {
      // 平台环境变量坏了就当没有这把钥匙。
    }
  }
  return keys
}

function presentedKeys(req: Request): string[] {
  const keys = [req.headers.get('apikey') ?? '']
  const authorization = req.headers.get('authorization') ?? ''
  const bearer = authorization.replace(/^Bearer\s+/i, '')
  if (bearer && bearer !== authorization) keys.push(bearer)
  return keys.filter(Boolean)
}

export function isAuthorized(req: Request, env: { SUPABASE_ANON_KEY?: string; SUPABASE_PUBLISHABLE_KEYS?: string }): boolean {
  const expected = new Set(projectKeys(env))
  if (expected.size === 0) return false
  return presentedKeys(req).some((key) => expected.has(key))
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  })
}

function readDenoEnv(): { SUPABASE_ANON_KEY?: string; SUPABASE_PUBLISHABLE_KEYS?: string } {
  const deno = (globalThis as { Deno?: { env?: { get: (name: string) => string | undefined } } }).Deno
  return {
    SUPABASE_ANON_KEY: deno?.env?.get('SUPABASE_ANON_KEY'),
    SUPABASE_PUBLISHABLE_KEYS: deno?.env?.get('SUPABASE_PUBLISHABLE_KEYS'),
  }
}

async function defaultResolve(hostname: string, record: DnsRecord): Promise<string[]> {
  const deno = (globalThis as { Deno?: { resolveDns?: DnsResolver } }).Deno
  if (!deno?.resolveDns) return []
  return deno.resolveDns(hostname, record)
}

export async function handleFetchLink(req: Request, env = readDenoEnv()): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!isAuthorized(req, env)) return json({ error: 'unauthorized' }, 401)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid_url' }, 400)
  }
  const url = payload && typeof payload === 'object' ? (payload as { url?: unknown }).url : null
  if (typeof url !== 'string' || url.length > 2000) return json({ error: 'invalid_url' }, 400)

  try {
    const preview = await fetchLinkMetadata(url, { resolve: defaultResolve })
    return json(preview, 200)
  } catch (error) {
    const code = error instanceof LinkError ? error.code : 'fetch_failed'
    const status = code === 'fetch_failed' || code === 'too_large' ? 502 : 400
    return json({ error: code }, status)
  }
}

const denoRuntime = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => void } }).Deno
if (denoRuntime?.serve) {
  denoRuntime.serve((req) => handleFetchLink(req))
}
