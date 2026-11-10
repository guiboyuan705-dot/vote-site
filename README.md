# 投票

输入一个议题，再贴上相关网站，就能生成一张可以转发的投票。每个人打开同一条链接，看到的是同一份票数。

页面是简体中文，手机上也能用。前端发布在 GitHub Pages，票数存在 Supabase（免费计划即可）。

合并并完成下面的设置之后，网站地址是：

**https://guiboyuan705-dot.github.io/vote-site/**

## 上线前要做的 6 步

密钥不要写进仓库。没配好数据库时，打开网站会看到一份中文说明，而不是一片空白。读取网站标题的函数如果还没部署，投票仍然能创建，选项名称会先用域名顶上。

### 1. 准备 Supabase 项目

1. 打开 [Supabase 控制台](https://supabase.com/dashboard) 并登录。
2. 新建一个项目，名字可以用 `vote-site`。地区选离你近的，例如东京或首尔。数据库密码自己保管，这个网站用不到它。
3. 等到项目状态变成 **Active**。

免费计划通常只能有两个项目。如果已经满了，就恢复一个你确认可以拿来存投票的项目，不要把下面的脚本跑进还在使用的数据库。项目闲置后会被暂停，数据还在，到控制台点 **Restore** 即可。

### 2. 建立数据表

1. 打开项目里的 **SQL Editor** → **New query**。
2. 打开本仓库的 [`supabase/migrations/20261110152903_init_polls.sql`](supabase/migrations/20261110152903_init_polls.sql)，全选复制，粘贴到查询框。
3. 点 **Run**。看到 Success 就可以。只需要运行一次。

这个脚本会建好投票、选项和选票，并关掉匿名用户直接读取选票的权限。页面只能拿到汇总后的票数，看不到每个浏览器的编号。

### 3. 部署“读取网站标题”的函数

浏览器里的页面不能直接去抓另一个网站的标题，对方不会允许这种跨站请求（CORS）。所以要有一个跑在服务器上的小函数：你提交网址，它在服务端打开页面，取出标题、简介和图标，再返回给页面。

函数名必须是 **`fetch-link`**。它会拒绝内网地址、本机地址和云主机的元数据地址，避免被拿去探测内网。

它还会核对请求里的 `apikey` 是不是这个项目的 publishable / anon key。请在部署时**关闭**平台自带的 JWT 校验（`--no-verify-jwt`，或控制台里关掉 Enforce JWT）。那个开关只认识旧版 anon JWT，打开之后，新的 publishable key 会全部 401。关掉它不等于把函数公开，没有正确 apikey 的请求会被拒绝。

用命令行部署（不需要 Docker）：

```bash
npx supabase login
npx supabase functions deploy fetch-link --project-ref 你的项目ID --no-verify-jwt --use-api
```

项目 ID 在 Supabase 的 Project Settings → General 里，是一串字母，也在浏览器地址栏 `/project/` 后面。

也可以在控制台操作：Edge Functions → Deploy a new function → 名字填 `fetch-link` → 把 [`supabase/functions/fetch-link/index.ts`](supabase/functions/fetch-link/index.ts) 的全部内容粘进去 → 关闭 Enforce JWT → Deploy。

这一步可以稍后做。没部署时，创建投票仍会成功，只是名称先显示成域名，你可以手改。

### 4. 在 GitHub 添加两个密钥

打开仓库 **Settings → Secrets and variables → Actions → New repository secret**，添加：

| 名称 | 填什么 |
| --- | --- |
| `VITE_SUPABASE_URL` | Project Settings → Data API 里的 Project URL，形如 `https://xxxxxxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Project Settings → API Keys 里的 **publishable** key（`sb_publishable_` 开头），或 legacy **anon** public key |

不要填写 `service_role`，也不要填写 `sb_secret_` 开头的密钥。那两把钥匙能绕过数据库权限。publishable / anon key 本来就会出现在网页里，这是 Supabase 的正常用法，权限靠第 2 步的数据库规则卡住。

如果网站不是挂在 `/vote-site/` 下面（例如以后绑了自己的域名并且挂在根路径），再添加一个 **Variable**（不是 Secret），名字 `VITE_BASE`，值填 `/`。当前这个仓库不用加。

### 5. 打开 GitHub Pages

**Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

### 6. 部署

把本分支合并进 `main`。到 **Actions** 打开 **Deploy GitHub Pages**。如果这次运行发生在你保存密钥之前，点 **Re-run all jobs**。密钥是在构建时写进页面的，只改 Secret、不重新构建，线上不会变。

成功后打开 https://guiboyuan705-dot.github.io/vote-site/ 。

如果仍看到“还差一步”，说明构建时密钥是空的，回到第 4 步核对名字是否完全一致，然后重新运行工作流。

## 使用

- **首页**列出最近 100 张投票。
- **新建**：填写议题；添加一个或多个网址，也可以再加纯文字选项；选择单选或多选；截止时间可以不填。
- 每个网址会变成一个选项，尽量显示网站标题、简介和图标。标题可以改。投票页上的链接可以点开。
- 每张票有自己的链接，页面上可以复制。
- 结果是票数、百分比和横条，打开页面后会自动刷新。
- 多选时，百分比按投票人数计算，各项加起来可以超过 100%。
- **每个浏览器投一次**。浏览器里会存一个随机编号，数据库不允许同一个编号再投。这是基本限制：清除本站数据或换一个浏览器后，可以再投一次。同一个浏览器正常使用时，第二次提交会被拒绝。

## 可选：只允许你本人新建

默认谁打开网站都能新建投票。如果只想自己建，在 SQL Editor 里运行（换成你自己的口令，至少 8 位；建议用英文和数字，最长大约 72 个字节）：

```sql
select private.set_owner_password('换成你的口令');
```

之后新建页面会要求填写管理口令。投票的人不需要口令。

取消限制：

```sql
select private.clear_owner_password();
```

删掉一张投票（选项和票数会一起删除）：

```sql
delete from public.polls where slug = '链接末尾那一串';
```

## 本地运行

```bash
npm install
cp .env.example .env.local
```

在 `.env.local` 里填上 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，然后：

```bash
npm run dev
```

默认从 http://localhost:5173/vote-site/ 打开。如果把 `VITE_BASE` 改成 `/`，则从 http://localhost:5173/ 打开。

```bash
npm test
npm run build
```

## 常见问题

- **打开就提示连不上数据库**：项目可能被暂停了。到 Supabase 控制台恢复。
- **提示数据库还没初始化**：第 2 步的 SQL 没跑成功，或跑到了另一个项目。
- **提示密钥不正确**：Secret 里放了 service_role / secret key，或复制少了字符。改完要重新部署。
- **Actions 里 Pages 相关步骤失败**：先做第 5 步，再重新运行。
- **标题一直是域名**：`fetch-link` 还没部署，或那个网站拒绝了抓取。可以在创建页手改名称。
