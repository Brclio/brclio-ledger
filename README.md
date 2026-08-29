# Brclio Ledger

一个部署在 Vercel、以 GitHub 文件作为远端数据源的在线 Excel 式记账表。

前端会把完整工作副本持久化到浏览器 `localStorage`：普通刷新优先恢复本地副本，不会自动拿远端内容覆盖正在编辑的数据；只有点击“保存到 GitHub”时才会验证编辑密码并形成一次 GitHub 提交。需要主动丢弃缓存、读取最新远端版本时，使用“强制刷新”。

## 已实现

- Excel 式表格：单元格编辑、键盘移动、多单元格粘贴、行选择、批量删除、快速新增。
- 本地工作副本：修改后自动写入浏览器缓存，关闭或刷新页面后仍保留；写入失败会明确报警并提示导出备份。
- 显式保存：只有点击保存或按 `⌘/Ctrl + S` 才推送 GitHub。
- 多密码编辑：不同密码可绑定不同编辑者名称，保存记录会标记对应名称。
- 安全会话：加盐 scrypt 密码校验、失败尝试限流，以及 `HttpOnly`、`SameSite=Strict` 的签名会话 Cookie。
- 冲突保护：使用 GitHub 文件 SHA 做乐观锁；远端已变化时可加载远端、导出本地草稿，或明确选择强制覆盖。
- 强制刷新：远端读取成功后才清除并替换缓存；有未保存修改时会先二次确认。
- CSV 导入 / 导出：可将外部明细追加到账本，也可随时下载完整工作副本；重复 ID 会自动重建。
- 查询与洞察：全文搜索、收支 / 月份 / 分类筛选、月度趋势、支出排行、结余概览。
- GitHub 保存历史：在应用内查看数据文件最近的提交记录。
- 账本设置：名称、币种、收支分类与账户列表均可配置。
- 响应式与可访问性：桌面、平板、手机布局，键盘操作、焦点状态与语义化标签。
- 隐私基础配置：默认阻止搜索引擎索引，附带 CSP、权限策略及防嵌入响应头。

## 数据流

```text
浏览器工作副本（localStorage）
        │ 仅点击保存
        ▼
Vercel Functions（密码 / 会话 / 数据校验）
        │ GitHub Contents API + 当前文件 SHA
        ▼
data/ledger.json（每次保存形成 Git commit）
```

关键行为：

| 操作 | 本地缓存 | GitHub |
| --- | --- | --- |
| 编辑单元格 | 自动更新 | 不访问 |
| 刷新 / 重开页面 | 恢复缓存 | 缓存存在时不读取 |
| 保存到 GitHub | 保存成功后标为已同步 | 校验密码并提交 |
| 强制刷新 | 远端成功返回后替换 | 读取最新文件 |
| 导出 CSV | 不改变 | 不访问 |

## 部署到 Vercel

### 1. 导入仓库

在 Vercel 新建项目并导入本仓库。框架会由 `vercel.json` 识别为 Vite；构建命令使用 `npm run build`。

### 2. 创建 GitHub Token

建议使用 fine-grained personal access token，只授权目标仓库，并只开放 `Contents: Read and write`。如果仓库是私有的，读取也依赖此 Token。

### 3. 配置环境变量

把 [.env.example](./.env.example) 中的变量加入 Vercel 项目：

| 变量 | 必填 | 说明 | 填写示例 | 生成 / 获取方式 |
| --- | --- | --- | --- | --- |
| `GITHUB_TOKEN` | 保存必填 | 仅服务端使用的 GitHub Token | `github_pat_••••••` | 在 GitHub Settings 创建 fine-grained token，仅授予本仓库 `Contents: Read and write` |
| `GITHUB_OWNER` | 是 | GitHub 用户名或组织名 | `Brclio` | 从仓库地址 `github.com/<owner>/<repo>` 的 `<owner>` 获取 |
| `GITHUB_REPO` | 是 | 保存账本的仓库名 | `brclio-ledger` | 从仓库地址 `github.com/<owner>/<repo>` 的 `<repo>` 获取 |
| `GITHUB_BRANCH` | 是 | 写入数据文件的分支 | `main` | 在本地仓库运行 `git branch --show-current` |
| `GITHUB_DATA_PATH` | 是 | 数据文件在仓库内的路径 | `data/ledger.json` | 直接填写，并确保仓库内已有对应文件 |
| `LEDGER_PASSWORD_HASHES` | 是 | 编辑者名称到加盐 scrypt 校验串的 JSON 对象 | `{"owner":"scrypt$16384$8$1$…"}` | 每个密码运行一次 `npm run hash-password`，再按编辑者名称组装为 JSON |
| `SESSION_SECRET` | 是 | 至少 32 个随机字符；更换后所有会话失效 | `<粘贴生成的 64 位十六进制串>` | 运行 `openssl rand -hex 32` |
| `SESSION_TTL_SECONDS` | 否 | 登录有效期，默认 12 小时 | `43200` | 直接填写；也可运行 `node -p "12 * 60 * 60"` 换算小时数 |
| `GITHUB_COMMITTER_NAME` | 否 | 自定义提交者名称 | `Brclio Ledger Bot` | 直接填写；需要与提交者邮箱同时配置 |
| `GITHUB_COMMITTER_EMAIL` | 否 | 自定义提交者邮箱 | `ledger@example.com` | 填写 GitHub 账户邮箱或 GitHub noreply 邮箱，并与提交者名称同时配置 |

交互式生成密码校验串（输入不会回显，也不会进入 shell 历史）：

```bash
npm run hash-password
```

生成会话密钥：

```bash
openssl rand -hex 32
```

多个密码的配置示例：

```text
LEDGER_PASSWORD_HASHES={"owner":"第一个scrypt校验串","family":"第二个scrypt校验串"}
```

也支持更易配置但不推荐的明文备选 `LEDGER_PASSWORDS={"owner":"密码一","family":"密码二"}`。不要把真实密码或 Token 写进仓库。

### 4. 部署与验证

保存环境变量并重新部署。首次打开应能读取 `data/ledger.json`；解锁编辑、添加一条测试记录并保存后，GitHub 中应出现形如 `ledger: save by owner` 的提交。

> 当前产品边界是“公开查看、密码编辑”：`GET /api/ledger` 与保存历史无需密码。私有 GitHub 仓库只能隐藏仓库原文件，不能阻止他人从已部署站点查看账本。账务内容需要保密时，请同时启用 Vercel 的访问保护，或为读取接口增加认证；`noindex` 与 `robots.txt` 只是不希望被索引，并不是访问控制。

浏览器缓存同样是明文工作副本，退出编辑不会清除它。共享设备请使用独立浏览器账户，并尽量只在一个标签页中编辑同一本账，避免两个本地草稿互相覆盖。内存限流是 Vercel Function 实例内的辅助防护，仍应使用足够长且唯一的密码。

## 本地开发

需要 Node.js 22.12 或更新版本。

```bash
npm install
cp .env.example .env.local
npm run dev:vercel
```

编辑 `.env.local`，填入测试用凭据后访问 Vercel CLI 输出的地址。`npm run dev` 只启动 Vite 前端，不提供 `/api/*` Functions，适合纯界面开发。

常用命令：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 数据格式与边界

远端数据固定保存在 `data/ledger.json`，当前 schema 版本为 `1`。服务端会校验日期、收支类型、非负金额、设置项和元数据；单次最多 5,000 条记录、序列化后最多约 900 KB。前端会为保存时的服务端元数据预留少量空间；服务端负责写入并再次校验 `meta.updatedAt` 与 `meta.updatedBy`。

GitHub 写入基于 [Repository Contents API](https://docs.github.com/en/rest/repos/contents)，Vercel 行为配置见 [Project Configuration](https://vercel.com/docs/project-configuration)。

## 设计与许可

界面基于 [ESTHER不二 / esther-design-system](https://github.com/esthersjw/esther-design-system) 的 App 场景规范改编：暖白纸张底色、深蓝 / 红 / 黄主色、编辑式不对称层级与手绘批注气质。原设计系统版权归 © 2026 ESTHER不二（esthersjw）所有。

本项目依 [CC BY-NC-SA 4.0](./LICENSE) 发布：需署名、禁止商用，修改后须以相同协议分享。
