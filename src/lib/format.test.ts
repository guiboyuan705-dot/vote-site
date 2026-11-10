import { describe, expect, it } from 'vitest'
import { barWidth, formatPercent } from './format'

describe('results', () => {
  it('formats percentages from the number of voters', () => {
    expect(formatPercent(0, 4)).toBe('0%')
    expect(formatPercent(1, 400)).toBe('<1%')
    expect(formatPercent(1, 2)).toBe('50%')
  })

  it('keeps a visible sliver for a small but nonzero vote', () => {
    expect(barWidth(0, 10)).toBe('0%')
    expect(barWidth(1, 1000)).toBe('1.5%')
    expect(barWidth(2, 2)).toBe('100%')
  })
})
