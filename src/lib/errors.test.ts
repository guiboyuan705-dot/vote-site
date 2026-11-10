import { describe, expect, it } from 'vitest'
import { mapError } from './errors'

describe('mapError', () => {
  it('translates known database errors', () => {
    expect(mapError(new Error('already_voted'))).toContain('已经投过')
    expect(mapError({ message: 'Could not find the function public.list_polls', code: 'PGRST202' })).toContain('数据库还没初始化')
  })
})
