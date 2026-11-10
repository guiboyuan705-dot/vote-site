const REPO = 'https://github.com/guiboyuan705-dot/vote-site'
const SQL = `${REPO}/blob/main/supabase/migrations/20261110152903_init_polls.sql`

export function SetupPage() {
  return (
    <section className="setup">
      <h1>还差一步，网站就能用</h1>
      <p className="lede">页面已经发布，但还没有连上保存票数的数据库。按下面做完，再重新运行一次 GitHub Actions 部署。</p>
      <ol>
        <li>
          打开 <a href="https://supabase.com/dashboard">Supabase</a>，新建一个项目，或恢复一个你愿意用来存投票的空项目。免费计划一般只能有两个项目。
        </li>
        <li>
          打开 SQL Editor，把仓库里的 <a href={SQL}>初始化脚本</a> 整份粘贴进去并运行。
        </li>
        <li>
          部署读取网页标题的函数 <code>fetch-link</code>。不部署也能投票，只是选项名称会暂时显示成域名。步骤写在仓库 README 里。
        </li>
        <li>
          在 GitHub 仓库 Settings → Secrets and variables → Actions 添加两个密钥：
          <div className="code">VITE_SUPABASE_URL</div>
          <div className="code">VITE_SUPABASE_ANON_KEY</div>
          第二个用 publishable key 或 anon key，不要用 service_role / secret key。
        </li>
        <li>
          Settings → Pages → Build and deployment → Source 选 <strong>GitHub Actions</strong>。然后到 Actions 里重新运行 “Deploy GitHub Pages”。
        </li>
      </ol>
      <p>
        完整说明：<a href={`${REPO}#readme`}>README</a>
      </p>
    </section>
  )
}
