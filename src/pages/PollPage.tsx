import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Favicon } from '../components/Favicon'
import { castVote, errorText, getPoll, type PollDetail } from '../lib/api'
import { copyText } from '../lib/copy'
import { barWidth, formatPercent, formatWhen } from '../lib/format'
import { hostnameOf, pollAbsoluteUrl, safeHttpUrl } from '../lib/urls'
import { getVoterToken } from '../lib/voter'

export function PollPage() {
  const { slug = '' } = useParams()
  const [poll, setPoll] = useState<PollDetail | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareUrl = pollAbsoluteUrl(slug)

  useEffect(() => {
    let stop = false
    async function load(silent: boolean) {
      if (!silent) setLoading(true)
      try {
        const next = await getPoll(slug, getVoterToken())
        if (stop) return
        setPoll(next)
        setError(null)
        if (next.voted_option_ids.length > 0) setSelected(next.voted_option_ids)
      } catch (caught) {
        if (!stop && !silent) setError(errorText(caught))
      } finally {
        if (!stop && !silent) setLoading(false)
      }
    }
    void load(false)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 6000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [slug])

  const locked = Boolean(poll && (poll.ended || poll.voted_option_ids.length > 0))

  function toggle(id: string) {
    if (!poll || locked) return
    setSelected((current) => {
      if (poll.allow_multiple) {
        return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      }
      return [id]
    })
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!poll || locked) return
    if (selected.length === 0) {
      setError(poll.allow_multiple ? '请至少选择一项。' : '请选择一项。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const next = await castVote(poll.slug, getVoterToken(), selected)
      setPoll(next)
      setSelected(next.voted_option_ids)
    } catch (caught) {
      const text = errorText(caught)
      setError(text)
      if (text.includes('已经投过')) {
        try {
          setPoll(await getPoll(poll.slug, getVoterToken()))
        } catch {
          // 保留刚才的错误提示。
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function onCopy() {
    const ok = await copyText(shareUrl)
    setCopied(ok)
    if (ok) window.setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <p className="hint">正在加载投票…</p>
  if (!poll) {
    return (
      <section className="card empty">
        <h1>找不到这个投票</h1>
        <p className="hint">{error || '链接可能不对，或投票已经被删掉。'}</p>
        <Link className="button" to="/">回首页</Link>
      </section>
    )
  }

  return (
    <article className="stack">
      <div>
        <div className="meta">
          <span className={poll.ended ? 'tag tag-ended' : 'tag'}>{poll.ended ? '已截止' : '进行中'}</span>
          <span>{poll.allow_multiple ? '多选' : '单选'}</span>
        </div>
        <h1 className="question">{poll.question}</h1>
        <p className="hint">
          {poll.ends_at ? `截止 ${formatWhen(poll.ends_at)}` : '没有截止时间'}
          {poll.voted_option_ids.length > 0 ? ' · 你已投票' : ''}
        </p>
      </div>

      <section className="share">
        <p>把这个链接发给要投票的人</p>
        <div className="share-row">
          <input readOnly value={shareUrl} aria-label="投票链接" onFocus={(event) => event.target.select()} />
          <button className="button" type="button" onClick={() => void onCopy()}>{copied ? '已复制' : '复制链接'}</button>
        </div>
      </section>

      {error ? <div className="banner error" role="alert">{error}</div> : null}
      {poll.ended ? <div className="banner">投票已截止，不能再投。</div> : null}
      {poll.voted_option_ids.length > 0 ? <div className="banner">这个浏览器已经投过，不能再改。结果会自动更新。</div> : null}

      <form className="stack" onSubmit={onSubmit}>
        {poll.options.map((option) => {
          const href = option.kind === 'link' ? safeHttpUrl(option.url) : null
          const checked = selected.includes(option.id)
          return (
            <div className={`choice${checked ? ' selected' : ''}${locked ? ' locked' : ''}`} key={option.id}>
              <label className="choice-main">
                <input
                  type={poll.allow_multiple ? 'checkbox' : 'radio'}
                  name="option"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggle(option.id)}
                />
                {option.kind === 'link' ? <Favicon src={option.favicon_url} pageUrl={href} /> : <span className="favicon-fallback" aria-hidden="true">文</span>}
                <span>
                  <h2>{option.label}</h2>
                  {href ? <span className="host">{hostnameOf(href)}</span> : null}
                  {option.description ? <p>{option.description}</p> : null}
                </span>
              </label>
              {href ? <a href={href} target="_blank" rel="noreferrer">打开网站</a> : null}
              <div className="bar" role="img" aria-label={`${option.votes} 票，${formatPercent(option.votes, poll.total_voters)}`}>
                <span style={{ width: barWidth(option.votes, poll.total_voters) }} />
              </div>
              <div className="tally">
                <span>{option.votes} 票</span>
                <span>{formatPercent(option.votes, poll.total_voters)}</span>
              </div>
            </div>
          )
        })}
        <p className="hint">
          共 {poll.total_voters} 人投票。
          {poll.allow_multiple ? ' 多项的百分比按人数计算，加起来可以超过 100%。' : ''}
          {' '}每个浏览器只能投一次。
        </p>
        {locked ? null : (
          <button className="button wide" type="submit" disabled={saving}>
            {saving ? '正在提交…' : '提交投票'}
          </button>
        )}
      </form>
    </article>
  )
}
