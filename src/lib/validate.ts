import { safeHttpUrl } from './urls'

export interface DraftOption {
  kind: 'link' | 'text'
  label: string
  url?: string | null
  description?: string | null
  favicon_url?: string | null
}

export function validateDraft(question: string, options: DraftOption[], endsAt: string | null): string | null {
  const title = question.trim()
  if (!title) return '请填写议题。'
  if ([...title].length > 200) return '议题请控制在 200 字以内。'
  if (options.length < 1) return '请至少添加一个网站或文字选项。'
  if (options.length > 20) return '选项最多 20 个。'

  const seen = new Set<string>()
  for (const option of options) {
    const label = option.label.trim()
    if (!label) return '每个选项都需要一个名称。'
    if ([...label].length > 300) return '选项名称请控制在 300 字以内。'
    if ((option.description ?? '').trim().length > 500) return '简介请控制在 500 字以内。'
    if (option.kind === 'link') {
      const url = option.url ? safeHttpUrl(option.url) : null
      if (!url) return '有一个链接格式不正确。'
      if (seen.has(url)) return '有重复的链接，请删掉多余的。'
      seen.add(url)
    }
  }

  if (endsAt) {
    const time = new Date(endsAt)
    if (Number.isNaN(time.getTime()) || time.getTime() <= Date.now()) {
      return '截止时间需要晚于现在。'
    }
  }
  return null
}
