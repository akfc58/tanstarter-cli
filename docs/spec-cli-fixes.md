# CLI 修复 Spec（源自 2026-08-24 full 档上线 QA）

**目标仓库**：本仓库 `akfc58/tanstarter-cli`
**来源**：一次用本 CLI 真实创建并部署 full 档项目（`full.fishwiththemoon.uk`）的端到端 QA
**配套**：模板侧的 11 条在 `akfc58/tanstack-template` 的 `docs/spec-template-fixes.md`，两份互不重叠

本文是可直接执行的待办。每条给出**问题、判据、改哪个文件、改成什么、怎么验证修好了**。
文件路径与行号均在本仓库核准过。

编号 `C1`–`C6` 与 QA 责任表的 `R*` 编号对应关系写在每条标题下。

---

## 执行顺序

1. **C1 与模板侧的 T2 成对做。** C1 是病（CLI 破坏生成项目的格式），T2 是「为什么没被发现」
   （模板的 CI 无质量门）。只修一边，下次 CLI 换个方式改文件还会重演且照样无人知晓。
2. **C2 优先级高于它的表面严重度**，理由见该条的「二阶后果」。
3. 其余按 P2 排。

---

## C1 · 重写 wrangler.jsonc 时破坏了生成项目的 Biome 格式（R2，P1）

**问题**：`writeWranglerConfig` 在 `src/wrangler-config.ts:45` 用
`JSON.stringify(next, null, 2)` 序列化后写回（第 64 行）。产出的格式不符合模板项目的
`biome.json`，本次表现为 `triggers.crons` 数组被从单行拆成多行。

**判据（实测）**：CLI 生成的项目里 `pnpm check` 直接失败：
```
wrangler.jsonc format ✗ Formatter would have printed the following content:
  - "crons": [\n    "0 0 * * *"\n  ]
  + "crons": ["0 0 * * *"]
Found 1 error.  → pnpm check exit 1
```

**为什么严重**：模板的 `pnpm check` 是 `biome check && tsc --noEmit && vitest run`，
biome 在**链首**。它一挂，**tsc 与 479 个单测根本没跑到**——也就是说生成的项目
从第一分钟起就失去了全部质量守卫，而使用者只会看到一条格式错误、很容易随手忽略。

**改哪**：`src/wrangler-config.ts` 的 `writeWranglerConfig`

**改成**，两条路径：
- 写回文件后，在生成项目目录里跑一次 `pnpm exec biome format --write wrangler.jsonc`
  （简单，但依赖生成项目已 `pnpm install`——注意 `write-config` 步骤在 `install` 之后，可行）
- 或改用能保序、保格式的 JSONC 序列化，从根上不产生差异（与 C3 一并解决）

**怎么验**：
```bash
tanstarter create <name> ...      # 生成一个项目
cd <name> && pnpm check           # 期望 biome 段 exit 0
```
**与模板侧 T2 一起做才真正闭合**：T2 给模板的 CI 加上 `pnpm check`，
这样将来任何同类回归会在 CI 变红，而不是绿着部署上去。

---

## C2 · gh 默认解析到 upstream，让人看着模板的绿灯以为自己项目正常（R16，P1）

**问题**：`initializeGit`（`src/git.ts:46`）保留了 `upstream` 远程，并把它的 pushurl
设为 `DISABLED`（第 200 行——这个防误推是对的，要保留）。但 **gh 的 fork 启发式**
只要看到名为 `upstream` 的 remote 就把它当 base repo。

**判据（实测）**：在生成的项目里
```bash
gh repo view --json nameWithOwner -q .nameWithOwner
# 返回 akfc58/tanstack-template，而不是 akfc58/tanstack-full
```
于是 `gh run list`、`gh pr list`、`gh secret list` 等**全部默认打到模板仓库**。

**二阶后果才是关键**：本次 QA 调研阶段据此误判「项目 CI 近 8 次全绿」——那其实是模板仓库的
历史。纠正后才发现项目仓库当时**只跑过一次 CI**、线上产物来自本地 `pnpm deploy`、
23 个 GitHub secret 从未被任何 CI 构建使用过。**一个诊断工具指错方向，
会连带污染基于它的所有结论。**

**改哪**：`src/git.ts`，在 `createGithubRepo`（第 61 行）成功之后

**改成**：执行 `gh repo set-default <owner>/<project>`。它写入 `.git/config` 的
`remote.origin.gh-resolved = base`，是非破坏性的、保留 `upstream` 供后续拉模板更新。
退而求其次是在完成提示里明确告知「后续 `gh` 命令需带 `--repo <owner>/<project>`」，
但那依赖使用者记住，不如直接设好。

**不建议**直接 `git remote remove upstream`——那会切断从模板拉取后续修复的通道，
而本次 QA 恰好产出了 11 条要回模板修的问题。

**怎么验**：生成项目里 `gh repo view --json nameWithOwner` 返回 **origin** 而非 upstream。

---

## C3 · wrangler.jsonc 的全部注释被删掉（R1，P2）

**问题**：同一个 `writeWranglerConfig`。`stripJsonc`（`src/wrangler-config.ts:71`）
逐字符去掉注释以便 `JSON.parse`，改完字段再 `JSON.stringify` 写回
——这是一次**有损往返**。

**判据（实测）**：`git show <init-commit> -- wrangler.jsonc` 显示模板里解释
`nodejs_compat`、`nodejs_compat_populate_process_env`、`global_fetch_strictly_public`、
`main`、cron 用途、`logpush`、`keep_vars`、`observability` 的说明性注释**全部丢失**。

JSONC 相对 JSON 的全部价值就在注释。模板作者用它们解释了「为什么开这个 flag」，
生成的项目拿不到这些信息。

**改哪**：`src/wrangler-config.ts`

**改成**：改为「只替换需要改的字段」的原地文本编辑（`name`、`routes`、
`d1_databases`、`r2_buckets`、`kv_namespaces` 五处），或改用保留注释的 JSONC 库。
前者改动小但要处理格式细节；后者更稳，也顺带解决 C1。

**怎么验**：生成项目的 `wrangler.jsonc` 仍含上述说明注释。

---

## C4 · delete 不清理自定义域名绑定与 Waffo 资源（R11，P2）

**问题**：`src/delete.ts` 的删除步骤只有五个：Cloudflare Worker、KV namespace、
R2 bucket（含先清空对象）、D1 database、GitHub repo。

**自定义域名只在确认清单里被打印**（`src/delete.ts:90`
`console.log(\`  Worker custom domain route: ${config.domain}\`)`），
**没有任何对应的删除动作**——`workers/domains` 的 API 调用只存在于
`src/cloudflare.ts:138,169` 的创建与查询路径。

**Waffo 侧完全不删**：`delete.ts` 不引用 `src/waffo.ts` 的任何接口。
用 `--payment waffo` 走完流程后，Waffo 后台的测试 store / products / webhook 会永久留存。

**为什么容易踩**：确认清单里把域名列了出来，读起来像是会被删掉，实际不会。
这种「列出来但不做」比「不列」更容易误导。

**改哪**：`src/delete.ts`

**改成**：
- 补上解绑 Workers custom domain 的 API 调用（`DELETE /accounts/{id}/workers/domains/{id}`，
  需先按 hostname 查出绑定 id，查询逻辑 `src/cloudflare.ts:169` 已有）
- Waffo 侧若其 API 支持删除则补；**不支持则在结束提示里显式告知需要手工清理哪些资源**，
  并把域名那行从「将删除」清单挪到「需手工确认」清单，不要只在确认时一闪而过

**怎么验**：跑一次 `tanstarter delete <name>` 后，Cloudflare 里无残留 route、
Waffo 后台无残留资源，或收到明确的手工清理提示。

---

## C5 · 文档里的仓库名与代码不一致（R12，P2）

**问题**：代码是事实来源——`src/constants.ts:3` 的 `DEFAULT_TEMPLATE_URL` 指向
`https://github.com/akfc58/tanstack-template.git`。但文档还停在旧的组织名。

**判据（实测）**：
```
README.md:172        upstream for https://github.com/MkFastHQ/mkfast-template.git
README.zh-CN.md:173  https://github.com/MkFastHQ/mkfast-template.git
package.json:8       "homepage": "https://github.com/MkFastHQ/tanstarter-cli#readme"
package.json:11      "repository.url": "https://github.com/MkFastHQ/tanstarter-cli"
package.json:14      "bugs.url": "https://github.com/MkFastHQ/tanstarter-cli/issues"
PUBLISH.md:11        GitHub repository: MkFastHQ/tanstarter-cli
```

**改哪**：上述六处

**改成**：统一为实际仓库名。若组织确实改过，`package.json` 的三处元数据也应同步，
否则 npm 页面上的链接会指向不存在的仓库。

**怎么验**：`grep -rn "MkFastHQ" --include='*.md' --include='*.json' . | grep -v node_modules`
零命中。

---

## C6 · README 没说清第三方 key 必须在运行前 export（R15，P2）

**问题**：`ensureEnvFiles` 只从**当前进程的 `process.env`** 取值
（`src/env.ts:21` 的 `getProcessEnvValuesFromExample`，实现在第 163-177 行，
逐个读 `process.env[key]`）。它既不读任何外部文件，也不交互提问。

**后果**：没有预先 `export` 的第三方 key 就配不进生成的项目，而 CLI 是一次性长跑到底的
Node 进程，中途不会重读 shell。使用者跑完才发现 Google 登录、Stripe、Turnstile 全是空的，
只能事后手改 `.env.production` 再重新构建部署。

**改哪**：`README.md` 与 `README.zh-CN.md` 的 Quick Start

**改成**：在「运行前准备」里列出完整的变量名清单，取自模板的 `env.example`：

```
GOOGLE_CLIENT_ID              GOOGLE_CLIENT_SECRET
STRIPE_SECRET_KEY             STRIPE_WEBHOOK_SECRET
VITE_STRIPE_PRICE_PRO_MONTHLY VITE_STRIPE_PRICE_PRO_YEARLY
VITE_STRIPE_PRICE_LIFETIME    VITE_STRIPE_PRICE_CREDITS_BASIC
VITE_STRIPE_PRICE_CREDITS_STANDARD
BEEHIIV_API_KEY               BEEHIIV_PUBLICATION_ID
DISCORD_WEBHOOK_URL
VITE_TURNSTILE_SITE_KEY       TURNSTILE_SECRET_KEY
VITE_PLAUSIBLE_SCRIPT         VITE_CLARITY_PROJECT_ID
```

同时**明确说明两件事**：
1. `VITE_PAYMENT_PROVIDER` 与 7 个 `WAFFO_*` 由 CLI 自己决定，
   用户 export 无效（`src/env.ts:22-25` 会先 `delete` 掉它们）
2. 选 `--payment none` 时 `VITE_PAYMENT_PROVIDER` 会被写成空串，得到「有账号但暂不收钱」
   的站点，`/pricing`、`/settings/billing` 与支付 webhook 都不生效——这一点
   `README.md:125` / `README.zh-CN.md:126` 已写明，Quick Start 里也值得指一句，
   因为它是首次部署后最容易困惑的现象

**怎么验**：按 README 走一遍能一次配齐，生成项目的 `.env.production` 里这些键都有非空值。

---

## 已裁决不做（不要再立项）

| 编号 | 结论 |
|---|---|
| **R3** 支付 provider 范围 | **已撤销，非缺陷。** CLI 支付层只自动化 Waffo（它需要通过 API 建 store / products / webhook），其他 provider 由用户在部署后手动配置，是刻意的范围划分。`README.md:125` 与 `README.zh-CN.md:126` 中英文均已写明。QA 中观察到的 `/pricing` 307 正是文档预期行为 |
| **R14** 首次部署 `VITE_BASE_URL` 烘成 localhost | 已记在本仓库 `docs/known-issues-and-follow-ups.md`。CLI 发现 workers.dev 地址后会二次构建，CI 也会用更新后的 secret 重建，已自愈。已评估不修 |
| **R10** CLI 代问站点名并写入 messages | 可选增强。当前 CLI 只改 `src/config/preset.ts`、`wrangler.jsonc`、`package.json`、`.env*`，不碰 `website.ts` 与 messages json。也可判定为「不做，归入模板的上线前人工清单」 |

---

## 回归验证范围

改完后，**用改后的 CLI 真实生成一个项目**（这正是本仓库
`docs/known-issues-and-follow-ups.md` 里记的那条 TODO：
「缺少覆盖 clone 真实模板到生成文件全链路的端到端测试」）：

```bash
tanstarter create qa-regression --preset account --repo <owner>/qa-regression
cd qa-regression

pnpm check                                        # C1：期望 exit 0
grep -c "nodejs_compat_populate_process_env" wrangler.jsonc   # C3：期望注释仍在
gh repo view --json nameWithOwner -q .nameWithOwner           # C2：期望返回 origin
```

**注意 `--preset account`**：模板侧的 T1 修好之前，account 档生成的项目
`pnpm check` 会挂在 `preset.test.ts` 的 `ACTIVE_PRESET === 'full'` 断言上——
那是模板的问题不是 CLI 的。**两边的修复要么一起验，要么先验 full 档**避免混淆。

清理：
```bash
tanstarter delete qa-regression      # C4：验证域名与 Waffo 资源的处理
```
