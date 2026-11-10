export interface SupabaseConfig {
  url: string
  anonKey: string
}

export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const json = JSON.parse(atob(padded)) as { role?: string }
    return json.role === 'service_role'
  } catch {
    return false
  }
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  } catch {
    return null
  }
  if (isSecretKey(anonKey)) return null
  return { url: url.replace(/\/$/, ''), anonKey }
}

export function isConfigured(): boolean {
  return getSupabaseConfig() !== null
}
