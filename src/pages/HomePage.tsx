import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorText, listPolls, type PollSummary } from '../lib/api'
import { formatWhen } from '../lib/format'

export function HomePage() {
  const [polls, setPolls] = useState<PollSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setPolls(await listPolls())
      setError(null)
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <section className="stack">
      <div>
        <h1>我的投票</h1>
        <p className="lede">写下议题，贴上相关网站，生成一张可以转发的票。</p>
        <Link className="button" to="/new">新建投票</Link>
      </div>
      {error ? <div className="banner error" role="alert">{error}</div> : null}
      {polls === null && !error ? <p className="hint">正在加载…</p> : null}
      {polls && polls.length === 0 ? (
        <div className="card empty">
          <h2>还没有投票</h2>
          <p className="hint">创建第一张，把链接发给要投票的人。</p>
        </div>
      ) : null}
      {polls && polls.length > 0 ? (
        <div className="poll-list">
          {polls.map((poll) => (
            <Link className="poll-card" key={poll.slug} to={`/p/${poll.slug}`}>
              <div className="poll-card-top">
                <span className={poll.ended ? 'tag tag-ended' : 'tag'}>{poll.ended ? '已截止' : '进行中'}</span>
                <time dateTime={poll.created_at}>{formatWhen(poll.created_at)}</time>
              </div>
              <h2>{poll.question}</h2>
              <p className="hint">{poll.total_voters} 人已投 · {poll.option_count} 个选项 · {poll.allow_multiple ? '多选' : '单选'}</p>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
