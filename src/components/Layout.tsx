import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="seal" aria-hidden="true">票</span>
          <span className="brand-text">
            <strong>投票</strong>
            <small>议题、链接、一票</small>
          </span>
        </Link>
        <Link to="/new" className="top-action">新建</Link>
      </header>
      <main className="content">{children}</main>
      <footer className="footer">同一张票的结果保存在数据库里，谁打开链接看到的票数都一样。</footer>
    </div>
  )
}
