# TanStarter CLI

[English](README.md) | 简体中文

使用 TanStarter 模板创建一个生产可用的 SaaS 项目，并在大约 10 分钟内部署到 Cloudflare Workers。

## 快速开始

本仓库从源码使用，不走 npm 发布。构建并链接一次即可：

```bash
git clone https://github.com/akfc58/tanstarter-cli.git
cd tanstarter-cli
pnpm install
pnpm build
npm link
```

然后进入你想创建新项目的目录，运行：

```bash
export CLOUDFLARE_ACCOUNT_ID="..." # 此处最好使用 keychain
export CLOUDFLARE_API_TOKEN="..."



# 可选：在初始化时启用 Waffo 支付
export WAFFO_MERCHANT_ID="MER_..."
export WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

npx tanstarter-cli@latest create
```

TanStarter CLI 会在真正创建资源之前询问项目名称、档位、资源名称和支付方式。选择 Waffo 后，它会自动创建 Waffo 门店、模板内置的三个产品和 Webhook。


## 安装

### 全局命令（推荐）

`npm link` 会把 `dist/index.js` 软链到 npm 全局 bin 目录，`tanstarter` 在任何位置都可用：

```bash
pnpm build
npm link

tanstarter --version
```

改动 `src/` 下的代码后，重新执行 `pnpm build` 即可。全局命令指向 `dist/`，不需要重新 link。

取消链接：

```bash
npm unlink -g tanstarter-cli
```

`pnpm link --global` 也可以，但在没执行过 `pnpm setup` 之前会报 `ERR_PNPM_NO_GLOBAL_BIN_DIR`。

### 直接跑源码

调试 CLI 本身时可以跳过构建：

```bash
pnpm dev create
pnpm dev --help
```

`pnpm dev` 实际执行 `tsx src/index.ts`。注意参数前**不要加 `--`**：`pnpm dev -- --help` 会把 `--` 原样传给 CLI，报 `Unknown option: --`。

### 直接跑构建产物

```bash
pnpm build
node /path/to/tanstarter-cli/dist/index.js create
```

## 命令

```bash
tanstarter create [options]
tanstarter delete <project-name> [options]
tanstarter create <project-name> --resume
```

参数：

- `--domain <domain>`：配置 Cloudflare 自定义域名路由。
- `--payment <none|waffo>`：生成项目的支付方式。选择 `waffo` 时，CLI 使用模板内置的月付、年付和一次性产品，并在初始化过程中自动创建 Waffo 门店、产品和 Webhook。
- `--preset <free|account|full>`：生成项目的站点档位，默认 `full`。在交互式终端中省略该参数时 CLI 会提问，直接回车即 `full`。详见 [档位](#档位)。
- `--repo <owner/name>`：创建指定的 GitHub 仓库。如果省略，TanStarter CLI 会默认使用当前 GitHub CLI 登录账号和项目名，例如 `open-fox/my-app`。
- `--resume`：从 `.tanstarter/state.json` 继续一次失败的初始化流程。
- `-h, --help`：显示帮助信息。
- `-v, --version`：显示版本号。

示例：

```bash
tanstarter create --domain app.example.com --repo mkfasthq/my-app
```

如果项目目录已经创建但流程中途失败，修复问题后可以运行：

```bash
tanstarter create my-app --resume
```

如需删除 CLI 创建的 Cloudflare 和 GitHub 资源，运行：

```bash
tanstarter delete my-app
```

## 档位

档位决定生成的站点需要开通哪些第三方账号。CLI 会把它写进项目的 `src/config/preset.ts`（`ACTIVE_PRESET` 常量）；之后想换档位，改这一行再重新部署即可。

| 档位 | 需要的第三方账号 | 得到什么 |
| --- | --- | --- |
| `free` | 不需要任何注册 | blog、about，以及你在此之上做的工具站或游戏站。`git push` 即上站。 |
| `account` | 邮件服务账号（auth 的硬依赖）；要收钱再加支付商 | 账号体系、账单、文件存储。 |
| `full` | 在上一档基础上再加 newsletter 账号和通知 webhook | 全部能力。 |

- **三档的 Cloudflare 资源完全一致。** 每一档都会创建 D1、R2、KV 并执行迁移，因为 Worker 启动就需要这三个 binding。所以 `free` 档同样会持有三个资源，闲置时都在免费额度内，不用不计费。`delete` 也不分档位，三个资源全删。
- **`free` 档拒绝支付。** `--preset free --payment waffo` 会直接报错退出，而不是静默忽略：`free` 关闭了账号体系，订阅和账单没有落点。
- **`account` / `full` 可以不选支付商。** 此时 `VITE_PAYMENT_PROVIDER` 留空，得到「有账号但暂不收钱」的站点，定价页、账单页和支付 webhook 都不生效。
- **模板必须带 preset 层。** 如果克隆下来的模板没有 `src/config/preset.ts`，或者其中的 `ACTIVE_PRESET` 声明形状已改变，CLI 会在克隆完成后立刻报错，此时还没有创建任何 Cloudflare 资源。

## 前置要求

- Node.js 20 或更高版本。
- pnpm，用于安装依赖和构建本仓库。
- 一个 Cloudflare 账号，并在当前 shell 环境中设置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。
- 一个已经通过 GitHub CLI 登录的 GitHub 账号。
- （仅 Waffo）在 Waffo 控制台（API & Development → API Keys）创建 Test API Key。将 `MER_...` 商户 ID 设置为 `WAFFO_MERCHANT_ID`，将 Waffo 提供的 private key 字符串设置为 `WAFFO_PRIVATE_KEY`，CLI 会原样传递该值。CLI 始终使用 Waffo 测试模式；没有自定义域名时会使用部署后的 `workers.dev` 地址注册 Webhook。

CLI 会检查 `node`、`pnpm`、`git`、`gh`、GitHub CLI 登录状态和 Cloudflare 凭证。如果缺少 `pnpm`、`git` 或 `gh`，CLI 会尝试通过系统可用的包管理器自动安装。

### 第三方凭据怎么进入生成的项目

CLI 会在启动时一次性从 `process.env` 读取所有取值，不会读取 `.env` 文件，不会为这些键弹出提示，运行过程中也不会重新读取你的 shell。启动前没有 `export` 的键，会在生成的 `.env` 和 `.env.production` 里留空，往往要等到网站已经上线才会发现：Google 登录、支付或 Turnstile 悄无声息地不生效。

完整变量清单以模板的 [`env.example`](https://github.com/akfc58/tanstack-template/blob/main/env.example) 为准，生成的 env 文件正是从它播种而来，是唯一的事实来源。首次运行前通常需要提前设置的变量：

| 分类 | 变量 |
| --- | --- |
| Cloudflare（必需） | `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` |
| Google 登录 | `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` |
| 事务邮件 | `RESEND_API_KEY` |
| 机器人防护 | `VITE_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` |
| Stripe / Creem 支付 | `STRIPE_*`、`CREEM_*`，以及它们的 `VITE_*_PRICE_*` / `VITE_*_PRODUCT_*` id |
| Newsletter 与通知 | `BEEHIIV_API_KEY`、`BEEHIIV_PUBLICATION_ID`、`DISCORD_WEBHOOK_URL`、`FEISHU_WEBHOOK_URL` |
| 数据分析 | `VITE_PLAUSIBLE_SCRIPT`、`VITE_UMAMI_SCRIPT`、`VITE_UMAMI_WEBSITE_ID`、`VITE_GOOGLE_ANALYTICS_ID`、`VITE_CLARITY_PROJECT_ID` |
| AI 功能 | `AI_CHAT_PROVIDER`、`OPENROUTER_API_KEY`、`OPENAI_API_KEY`、`AI_COMPAT_*`、`FAL_KEY` |

留空的变量可以后续补上，编辑 `.env.production`，再运行 `pnpm run sync-worker-secrets`。

### 由 CLI 决定的变量

以下变量即使 export 了也不会生效，CLI 会丢弃 shell 里的值，写入自己的值：

- `VITE_PAYMENT_PROVIDER`
- `WAFFO_DEBUG`、`WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY`、`WAFFO_STORE_ID`、
  `VITE_WAFFO_PRODUCT_PRO_MONTHLY`、`VITE_WAFFO_PRODUCT_PRO_YEARLY`、
  `VITE_WAFFO_PRODUCT_LIFETIME`

（`WAFFO_MERCHANT_ID` 和 `WAFFO_PRIVATE_KEY` 在 `--payment waffo` 场景下仍然会从 shell 读取，作为创建 Waffo 资源用的凭证，CLI 真正决定的是写入生成项目里的值。）

没有传 `--payment waffo` 时，`VITE_PAYMENT_PROVIDER` 会写成空值，也就是「有账号但没有收银台」的站点：`/pricing` 会跳转，`/settings/billing` 不生效，支付 webhook 也不会触发。这是首次部署后最常见的困惑来源，想开始收费时，在 `.env.production` 里设置支付商并重新部署即可。

### 非交互式 Waffo 配置

在没有 TTY 的环境中，请传入 `--payment waffo`。不需要再提供门店名、产品名、价格或额外的 Waffo 环境变量，CLI 会直接使用模板内置定价。`--domain` 是可选的：

```bash
npx tanstarter-cli@latest create my-app --payment waffo
```

CLI 会创建一个以项目名命名的门店，并创建模板内置的三个产品：Pro 月付 `$9.90`、Pro 年付 `$99.00`、Lifetime 一次性 `$199.00`。三个产品 ID 分别写入 `VITE_WAFFO_PRODUCT_PRO_MONTHLY`、`VITE_WAFFO_PRODUCT_PRO_YEARLY` 和 `VITE_WAFFO_PRODUCT_LIFETIME`，然后部署网站、同步 Worker secrets、验证公网地址，最后注册 `https://<域名>/api/webhooks/waffo`（没有自定义域名时使用部署后的 `workers.dev` 地址）。线上 Worker 会保留 `WAFFO_DEBUG=true`，因此上线后的站点走 Waffo 测试支付流程。

CLI 初始化始终使用 Waffo 测试模式，正式产品发布不属于这个初始化流程。

Waffo 仍可能要求在控制台完成商户验证、企业资料和收款账户等流程。

## 它会做什么

初始化流程：

1. 克隆 TanStarter 模板、保留其 Git 历史，并把选定档位写入 `src/config/preset.ts`。
2. 使用 `pnpm install` 安装依赖。
3. 验证 Cloudflare 认证。
4. （仅 Waffo）创建 Waffo 门店和模板内置的三个产品。
5. 创建 Cloudflare D1、R2 和 KV 资源。
6. 更新 `wrangler.jsonc` 并写入 `.env`/`.env.production`。
7. 执行数据库迁移。
8. 本地构建并部署。
9. 同步 Worker secrets。
10. 验证公网部署地址。
11. （仅 Waffo）确认部署路由可访问后注册 Webhook。
12. 创建 GitHub 仓库并设为 gh 默认仓库。
13. 同步 GitHub Actions secrets。
14. 提交代码并推送到 `main` 分支。

生成的仓库使用 `origin` 指向新建的 GitHub 仓库，并使用 `upstream` 指向
`https://github.com/akfc58/tanstack-template.git`。由于模板历史会被保留，
后续升级可以直接使用正常的 Git 合并，无需重新建立共同祖先。CLI 还会在你的仓库上
运行 `gh repo set-default`，因此 `gh run list`、`gh pr list`、`gh secret list`
会作用在你的项目上，而不会通过 `upstream` 远程解析到模板仓库。

生成的 `.env` 和 `.env.production` 会先完整复制模板的 `env.example` 清单，保证其中声明的变量一个不少；当前 shell 中已存在的同名变量会在此基础上填入，CLI 自动生成的 Cloudflare、D1、KV、base URL 和 auth secret 等值优先生效。

## 链接

- 官网：[tanstarter.dev](https://tanstarter.dev)
- CLI 文档：[docs.tanstarter.dev/docs/cli](https://docs.tanstarter.dev/docs/cli)
- CLI 视频教程：[youtu.be/HVwilCX6YSA](https://youtu.be/HVwilCX6YSA)

## 支持

如果你遇到问题，可以发送邮件到 [support@tanstarter.dev](mailto:support@tanstarter.dev)，或者加入 [Discord 社区](https://mksaas.link/discord) 寻求帮助。

## License

MIT
