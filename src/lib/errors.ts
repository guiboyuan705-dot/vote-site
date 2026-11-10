export function mapError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code ?? '') : ''
  const text = `${code} ${message}`

  if (text.includes('already_voted')) return '这个浏览器已经投过票了。'
  if (text.includes('poll_ended')) return '投票已经截止。'
  if (text.includes('poll_not_found')) return '没有找到这个投票，链接可能不对。'
  if (text.includes('invalid_password')) return '管理口令不正确。'
  if (text.includes('ends_at_past')) return '截止时间需要晚于现在。'
  if (text.includes('invalid_options')) return '请检查勾选的选项。'
  if (text.includes('invalid_voter')) return '浏览器标识无效，请刷新页面后再试。'
  if (text.includes('invalid_input')) return '请检查议题和选项是否填写正确。'
  if (text.includes('Invalid API key') || text.includes('invalid api key') || code === '401') {
    return 'Supabase 密钥不正确。请确认 GitHub Secret 里是 publishable 或 anon key，然后重新运行部署。'
  }
  if (
    text.includes('PGRST202') ||
    text.includes('Could not find the function') ||
    text.includes('schema cache') ||
    text.includes('does not exist')
  ) {
    return '数据库还没初始化。请按说明在 Supabase 的 SQL Editor 里运行迁移脚本。'
  }
  if (text.includes('Failed to fetch') || text.includes('NetworkError') || text.includes('Load failed')) {
    return '网络连不上数据库。项目如果被暂停了，先到 Supabase 控制台恢复它。'
  }
  return '操作没有成功，请稍后再试。'
}
