import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from './config'

let client: SupabaseClient | null = null

export function getClient(): SupabaseClient | null {
  const config = getSupabaseConfig()
  if (!config) return null
  if (!client) {
    client = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}
