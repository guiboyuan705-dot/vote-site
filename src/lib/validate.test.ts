import { describe, expect, it } from 'vitest'
import { validateDraft } from './validate'

describe('validateDraft', () => {
  it('requires a question and one option', () => {
    expect(validateDraft('  ', [], null)).toBe('请填写议题。')
    expect(validateDraft('去哪', [], null)).toBe('请至少添加一个网站或文字选项。')
  })

  it('accepts a link and a text option', () => {
    expect(validateDraft('去哪', [
      { kind: 'link', label: '甲', url: 'https://example.com/a' },
      { kind: 'text', label: '都不去' },
    ], null)).toBeNull()
  })

  it('rejects a duplicate link and a past deadline', () => {
    const options = [
      { kind: 'link' as const, label: '甲', url: 'https://example.com/' },
      { kind: 'link' as const, label: '乙', url: 'https://example.com/' },
    ]
    expect(validateDraft('去哪', options, null)).toBe('有重复的链接，请删掉多余的。')
    expect(validateDraft('去哪', [options[0]], '2000-01-01T00:00')).toBe('截止时间需要晚于现在。')
  })
})
