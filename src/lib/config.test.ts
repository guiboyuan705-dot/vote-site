import { describe, expect, it } from 'vitest'
import { isSecretKey } from './config'

function jwt(payload: Record<string, string>): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.sig`
}

describe('isSecretKey', () => {
  it('rejects service role and secret keys', () => {
    expect(isSecretKey('sb_secret_example')).toBe(true)
    expect(isSecretKey(jwt({ role: 'service_role' }))).toBe(true)
    expect(isSecretKey(jwt({ role: 'anon' }))).toBe(false)
    expect(isSecretKey('sb_publishable_example')).toBe(false)
  })
})
