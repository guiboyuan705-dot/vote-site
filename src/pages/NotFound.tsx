import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <section className="card empty">
      <h1>没有这一页</h1>
      <p className="hint">链接可能写错了。</p>
      <Link className="button" to="/">回首页</Link>
    </section>
  )
}
