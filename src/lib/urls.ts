export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.href.length > 2000) return null
    return url.toString()
  } catch {
    return null
  }
}

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 2000) return null
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  return safeHttpUrl(withProtocol)
}

export function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

export function joinPollUrl(origin: string, base: string, slug: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const path = `${normalizedBase}p/${encodeURIComponent(slug)}`.replace(/([^:]\/)\/+/g, '$1')
  return new URL(path, origin).toString()
}

export function appBasename(): string | undefined {
  const raw = import.meta.env.BASE_URL || '/'
  const trimmed = raw.replace(/\/$/, '')
  return trimmed === '' ? undefined : trimmed
}

export function pollAbsoluteUrl(slug: string): string {
  return joinPollUrl(window.location.origin, import.meta.env.BASE_URL || '/', slug)
}
