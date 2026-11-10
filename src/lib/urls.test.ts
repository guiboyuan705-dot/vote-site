import { describe, expect, it } from 'vitest'
import { hostnameOf, joinPollUrl, normalizeUrl, safeHttpUrl } from './urls'

describe('urls', () => {
  it('adds https and keeps the path', () => {
    expect(normalizeUrl('example.com/docs')).toBe('https://example.com/docs')
  })

  it('rejects javascript and credentials', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('https://user:pass@example.com/')).toBeNull()
  })

  it('reads a hostname', () => {
    expect(hostnameOf('https://www.example.com/a')).toBe('example.com')
  })

  it('builds a project-pages poll link', () => {
    expect(joinPollUrl('https://guiboyuan705-dot.github.io', '/vote-site/', 'abc123')).toBe(
      'https://guiboyuan705-dot.github.io/vote-site/p/abc123',
    )
  })
})
