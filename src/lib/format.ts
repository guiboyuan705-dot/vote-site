export function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatPercent(votes: number, total: number): string {
  if (total <= 0 || votes <= 0) return '0%'
  const value = (votes / total) * 100
  if (value < 1) return '<1%'
  return `${Math.round(value)}%`
}

export function barWidth(votes: number, total: number): string {
  if (total <= 0 || votes <= 0) return '0%'
  const width = Math.min(Math.max((votes / total) * 100, 1.5), 100)
  return `${width}%`
}
