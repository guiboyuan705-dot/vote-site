import { mapError } from './errors'
import { getClient } from './supabase'
import { safeHttpUrl } from './urls'

export interface PollOption {
  id: string
  kind: 'link' | 'text'
  label: string
  url: string | null
  description: string | null
  favicon_url: string | null
  votes: number
}

export interface PollDetail {
  slug: string
  question: string
  allow_multiple: boolean
  ends_at: string | null
  created_at: string
  ended: boolean
  total_voters: number
  voted_option_ids: string[]
  options: PollOption[]
}

export interface PollSummary {
  slug: string
  question: string
  allow_multiple: boolean
  ends_at: string | null
  created_at: string
  ended: boolean
  option_count: number
  total_voters: number
}

export interface LinkMeta {
  title: string
  description: string
  favicon_url: string | null
}

export interface NewOption {
  kind: 'link' | 'text'
  label: string
  url?: string | null
  description?: string | null
  favicon_url?: string | null
}

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

function asOption(value: unknown): PollOption {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const kind = row.kind === 'link' ? 'link' : 'text'
  return {
    id: String(row.id ?? ''),
    kind,
    label: String(row.label ?? ''),
    url: typeof row.url === 'string' ? row.url : null,
    description: typeof row.description === 'string' ? row.description : null,
    favicon_url: typeof row.favicon_url === 'string' ? row.favicon_url : null,
    votes: Number(row.votes ?? 0) || 0,
  }
}

export function asPollDetail(data: unknown): PollDetail {
  if (!data || typeof data !== 'object') throw new ApiError('bad_payload')
  const row = data as Record<string, unknown>
  const slug = String(row.slug ?? '')
  if (!slug) throw new ApiError('bad_payload')
  return {
    slug,
    question: String(row.question ?? ''),
    allow_multiple: Boolean(row.allow_multiple),
    ends_at: row.ends_at ? String(row.ends_at) : null,
    created_at: String(row.created_at ?? ''),
    ended: Boolean(row.ended),
    total_voters: Number(row.total_voters ?? 0) || 0,
    voted_option_ids: Array.isArray(row.voted_option_ids) ? row.voted_option_ids.map(String) : [],
    options: Array.isArray(row.options) ? row.options.map(asOption) : [],
  }
}

export function asPollList(data: unknown): PollSummary[] {
  if (!Array.isArray(data)) return []
  return data.map((item) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    return {
      slug: String(row.slug ?? ''),
      question: String(row.question ?? ''),
      allow_multiple: Boolean(row.allow_multiple),
      ends_at: row.ends_at ? String(row.ends_at) : null,
      created_at: String(row.created_at ?? ''),
      ended: Boolean(row.ended),
      option_count: Number(row.option_count ?? 0) || 0,
      total_voters: Number(row.total_voters ?? 0) || 0,
    }
  }).filter((item) => item.slug)
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = getClient()
  if (!supabase) throw new ApiError('missing_config')
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new ApiError(error.message, error.code)
  return data as T
}

export async function listPolls(): Promise<PollSummary[]> {
  return asPollList(await rpc('list_polls'))
}

export async function getPoll(slug: string, voterToken: string): Promise<PollDetail> {
  return asPollDetail(await rpc('get_poll', { slug, voter_token: voterToken }))
}

export async function creationRequiresPassword(): Promise<boolean> {
  return Boolean(await rpc('creation_requires_password'))
}

export async function createPoll(input: {
  question: string
  allowMultiple: boolean
  endsAt: string | null
  options: NewOption[]
  password: string | null
}): Promise<string> {
  const data = await rpc<{ slug?: string }>('create_poll', {
    question: input.question.trim(),
    allow_multiple: input.allowMultiple,
    ends_at: input.endsAt,
    options: input.options.map((option) => ({
      kind: option.kind,
      label: option.label.trim(),
      url: option.kind === 'link' ? option.url ?? null : null,
      description: option.description?.trim() || null,
      favicon_url: option.favicon_url ? safeHttpUrl(option.favicon_url) : null,
    })),
    password: input.password,
  })
  const slug = data?.slug
  if (!slug) throw new ApiError('bad_payload')
  return slug
}

export async function castVote(slug: string, voterToken: string, optionIds: string[]): Promise<PollDetail> {
  return asPollDetail(await rpc('cast_vote', { slug, voter_token: voterToken, option_ids: optionIds }))
}

export async function fetchLinkMeta(url: string): Promise<LinkMeta | null> {
  const supabase = getClient()
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('fetch-link', { body: { url } })
    if (error || !data || typeof data !== 'object') return null
    const row = data as Record<string, unknown>
    if (row.error) return null
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    if (!title) return null
    return {
      title: title.slice(0, 300),
      description: typeof row.description === 'string' ? row.description.trim().slice(0, 500) : '',
      favicon_url: typeof row.favicon_url === 'string' ? safeHttpUrl(row.favicon_url) : null,
    }
  } catch {
    return null
  }
}

export function errorText(error: unknown): string {
  return mapError(error)
}
