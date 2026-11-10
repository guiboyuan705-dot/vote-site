import { useEffect, useState, type ClipboardEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { creationRequiresPassword, createPoll, errorText, fetchLinkMeta } from '../lib/api'
import { hostnameOf, normalizeUrl } from '../lib/urls'
import { validateDraft, type DraftOption } from '../lib/validate'
import { Favicon } from '../components/Favicon'

interface UrlDraft {
  id: string
  raw: string
  label: string
  description: string
  favicon: string | null
  status: 'idle' | 'loading' | 'ready' | 'fallback'
  resolvedRaw: string | null
}

interface TextDraft {
  id: string
  label: string
}

function newId(): string {
  return crypto.randomUUID()
}

function blankUrl(): UrlDraft {
  return { id: newId(), raw: '', label: '', description: '', favicon: null, status: 'idle', resolvedRaw: null }
}

function localStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
  return results
}

async function resolveRow(row: UrlDraft, force: boolean): Promise<UrlDraft> {
  const normalized = normalizeUrl(row.raw)
  if (!normalized) {
    return { ...row, status: row.raw.trim() ? 'fallback' : 'idle', resolvedRaw: row.raw }
  }
  if (!force && row.status === 'ready' && row.resolvedRaw === row.raw && row.label.trim()) return row
  const meta = await fetchLinkMeta(normalized)
  const host = hostnameOf(normalized)
  if (!meta) {
    return {
      ...row,
      label: row.label.trim() || host,
      status: 'fallback',
      resolvedRaw: row.raw,
    }
  }
  return {
    ...row,
    label: !force && row.label.trim() ? row.label : meta.title || host,
    description: !force && row.description.trim() ? row.description : meta.description,
    favicon: meta.favicon_url,
    status: 'ready',
    resolvedRaw: row.raw,
  }
}

export function CreatePage() {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const [urls, setUrls] = useState<UrlDraft[]>([blankUrl()])
  const [texts, setTexts] = useState<TextDraft[]>([])
  const [multiple, setMultiple] = useState(false)
  const [endsAt, setEndsAt] = useState('')
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [busy, setBusy] = useState<'idle' | 'fetch' | 'save'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [minEnds] = useState(() => localStamp(new Date(Date.now() + 60_000)))

  useEffect(() => {
    void creationRequiresPassword().then(setNeedsPassword).catch((caught) => setError(errorText(caught)))
  }, [])

  function updateUrl(id: string, raw: string) {
    setUrls((current) => current.map((row) => (row.id === id ? { ...row, raw, status: 'idle' } : row)))
  }

  function onPaste(id: string, event: ClipboardEvent<HTMLInputElement>) {
    const parts = event.clipboardData.getData('text').split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean)
    if (parts.length <= 1) return
    event.preventDefault()
    setUrls((current) => {
      const index = current.findIndex((row) => row.id === id)
      if (index < 0) return current
      const next = [...current]
      const [first, ...rest] = parts
      next[index] = { ...blankUrl(), id, raw: first }
      next.splice(index + 1, 0, ...rest.map((raw) => ({ ...blankUrl(), raw })))
      return next
    })
  }

  async function resolveAll(force: boolean) {
    setBusy('fetch')
    setError(null)
    try {
      const next = await mapPool(urls, 4, (row) => resolveRow(row, force))
      setUrls(next)
      return next
    } finally {
      setBusy('idle')
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy('save')
    try {
      const resolved = await mapPool(urls, 4, (row) => resolveRow(row, false))
      setUrls(resolved)
      const options: DraftOption[] = []
      const seen = new Set<string>()
      for (const row of resolved) {
        const url = normalizeUrl(row.raw)
        if (!url || seen.has(url)) continue
        seen.add(url)
        options.push({
          kind: 'link',
          label: row.label.trim() || hostnameOf(url),
          url,
          description: row.description.trim() || null,
          favicon_url: row.favicon,
        })
      }
      for (const row of texts) {
        if (!row.label.trim()) continue
        options.push({ kind: 'text', label: row.label.trim() })
      }
      const problem = validateDraft(question, options, endsAt || null)
      if (problem) {
        setError(problem)
        return
      }
      const slug = await createPoll({
        question,
        allowMultiple: multiple,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        options,
        password: password.trim() ? password : null,
      })
      navigate(`/p/${slug}`)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy('idle')
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div>
        <h1>新建投票</h1>
        <p className="lede">每个网址会变成一个选项。服务器会试着读出网站标题、简介和图标；读不到就用域名。</p>
      </div>
      {error ? <div className="banner error" role="alert">{error}</div> : null}
      <label className="field">
        <span>议题</span>
        <textarea
          value={question}
          maxLength={200}
          required
          placeholder="例如：这周团建去哪？"
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>

      <section className="card stack">
        <div className="section-label">相关网站</div>
        <p className="hint">浏览器不能直接读取别的网站（会被 CORS 拦住），所以点“读取网站信息”后由服务器代为打开。一次可以粘贴多行网址。</p>
        {urls.map((row, index) => {
          const normalized = normalizeUrl(row.raw)
          return (
            <div className="url-row" key={row.id}>
              <div className="url-head">
                <span className="hint">链接 {index + 1}</span>
                {urls.length > 1 ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setUrls((current) => current.filter((item) => item.id !== row.id))}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              <input
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                value={row.raw}
                onChange={(event) => updateUrl(row.id, event.target.value)}
                onPaste={(event) => onPaste(row.id, event)}
              />
              {row.status === 'ready' || row.status === 'fallback' ? (
                <div className="preview">
                  <Favicon src={row.favicon} pageUrl={normalized} />
                  <div className="stack">
                    <input
                      type="text"
                      aria-label={`选项 ${index + 1} 的名称`}
                      value={row.label}
                      maxLength={300}
                      onChange={(event) => setUrls((current) => current.map((item) => item.id === row.id ? { ...item, label: event.target.value } : item))}
                    />
                    <input
                      type="text"
                      aria-label={`选项 ${index + 1} 的简介`}
                      placeholder="简介，可选"
                      value={row.description}
                      maxLength={500}
                      onChange={(event) => setUrls((current) => current.map((item) => item.id === row.id ? { ...item, description: event.target.value } : item))}
                    />
                    {row.status === 'fallback' ? <p className="hint">没有读到标题，已用域名代替。你可以自己改名称。</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
        <div className="inline-actions">
          <button className="button-secondary" type="button" onClick={() => setUrls((current) => [...current, blankUrl()])}>添加网址</button>
          <button className="button-secondary" type="button" disabled={busy !== 'idle'} onClick={() => void resolveAll(true)}>
            {busy === 'fetch' ? '正在读取…' : '读取网站信息'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <div className="section-label">其他选项（可选）</div>
        <p className="hint">不带链接的文字选项，比如“都不满意”。</p>
        {texts.map((row, index) => (
          <div className="text-row" key={row.id}>
            <div className="url-head">
              <span className="hint">文字 {index + 1}</span>
              <button className="text-button" type="button" onClick={() => setTexts((current) => current.filter((item) => item.id !== row.id))}>删除</button>
            </div>
            <input
              type="text"
              maxLength={300}
              value={row.label}
              placeholder="选项名称"
              onChange={(event) => setTexts((current) => current.map((item) => item.id === row.id ? { ...item, label: event.target.value } : item))}
            />
          </div>
        ))}
        <button className="button-secondary" type="button" onClick={() => setTexts((current) => [...current, { id: newId(), label: '' }])}>添加文字选项</button>
      </section>

      <section className="card stack">
        <div className="section-label">规则</div>
        <div className="segment" role="group" aria-label="投票方式">
          <button type="button" aria-pressed={!multiple} onClick={() => setMultiple(false)}>单选</button>
          <button type="button" aria-pressed={multiple} onClick={() => setMultiple(true)}>多选</button>
        </div>
        <p className="hint">{multiple ? '可以选择多项，提交后不能再改。' : '只能选一项，提交后不能再改。'}</p>
        <label className="field">
          <span>截止时间（可选）</span>
          <input type="datetime-local" min={minEnds} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          <span className="hint">按你这台设备的本地时间。不填就可以一直投。</span>
        </label>
        {endsAt ? <button className="text-button" type="button" onClick={() => setEndsAt('')}>清除截止时间</button> : null}
        {needsPassword ? (
          <label className="field">
            <span>管理口令</span>
            <input type="password" value={password} autoComplete="off" onChange={(event) => setPassword(event.target.value)} required />
          </label>
        ) : (
          <details>
            <summary>我设置过管理口令</summary>
            <label className="field">
              <span>管理口令</span>
              <input type="password" value={password} autoComplete="off" onChange={(event) => setPassword(event.target.value)} />
            </label>
          </details>
        )}
      </section>

      <button className="button wide" type="submit" disabled={busy !== 'idle'}>
        {busy === 'save' ? '正在生成…' : '生成投票'}
      </button>
    </form>
  )
}
