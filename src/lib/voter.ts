const STORAGE_KEY = 'vote-site.voter-token'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let memoryToken: string | null = null

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return '00000000-0000-4000-8000-000000000001'
}

function readStore(store: Storage): string | null {
  try {
    const value = store.getItem(STORAGE_KEY)
    return value && UUID_RE.test(value) ? value : null
  } catch {
    return null
  }
}

function writeStore(store: Storage, token: string): boolean {
  try {
    store.setItem(STORAGE_KEY, token)
    return true
  } catch {
    return false
  }
}

export function getVoterToken(): string {
  if (typeof localStorage !== 'undefined') {
    const saved = readStore(localStorage)
    if (saved) return saved
  }
  if (typeof sessionStorage !== 'undefined') {
    const saved = readStore(sessionStorage)
    if (saved) return saved
  }
  if (!memoryToken || !UUID_RE.test(memoryToken)) memoryToken = randomToken()
  if (typeof localStorage !== 'undefined' && writeStore(localStorage, memoryToken)) return memoryToken
  if (typeof sessionStorage !== 'undefined') writeStore(sessionStorage, memoryToken)
  return memoryToken
}
