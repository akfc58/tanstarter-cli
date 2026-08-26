# 已知问题与后续事项

更新时间：2026-08-26

## 低危遗留（已评估，暂不修复）

### 首次部署把 VITE_BASE_URL 烘成 localhost

deploy 步骤执行时 workers.dev 地址尚未产生，`.env.production` 里 `VITE_BASE_URL` 是兜底的
`http://localhost:3000`。**自愈发生在 CLI 自己身上**，不是 CI：`src/index.ts` 在没有自定义域时
拿到 workers.dev 地址后会重写 `.env.production` 并**二次执行 `pnpm run deploy`**。
2026-08-25 三档实跑确认：三个站点的 canonical 与 `sitemap.xml` 均无 localhost。

代价是使用者会看到两次 deploy，README 未说明，容易被误认为出错。

### KV 与 R2 的两条「假成功」分支

都是条件分支，正常路径不触发；2026-08-25 的三档拆除中均未走到。

- `src/cloudflare.ts` 的 `deleteKV`：`kvNamespaceId` 为空时打印一行提示后**正常返回**，
  外层 `runDeleteStep` 只捕获异常，于是照常打 ✅。触发前提是 `create` 在
  `wrangler kv namespace create` 返回之后、`writeState` 之前被中断。
- `src/delete.ts` 的 `isAlreadyDeleted`：`'Not Found'` 是子串匹配、五个步骤共用。
  `deleteR2` 先调 `emptyR2Bucket`（v4 API），该调用若 404 会被判成「已删除」，
  真正的 `wrangler r2 bucket delete` 不会执行。

**已裁决不修**：触发前提罕见，且模板仓库 `docs/cli-contract.md` 的 K6 已写明
「拆除后必须到 dashboard 肉眼确认，不要信终端输出」。

### 其他已裁决不修

| 条目 | 结论 |
|---|---|
| `test:template` 不在 CI 里 | 5 条集成测试需要私有模板仓库的凭据 |
| 从不询问 `BACKUP_S3_*` | 备份桶是项目级决策，不适合放进生成流程。代价是生成项目的 `backup-d1.yml` 每周日会红一次 |
| 自动跑 `db:migrate:remote` | 首次开的是空库，无数据可毁。模板 `AGENTS.md` 那条「必须人工执行」针对的是已有数据的项目的后续迁移 |
| Waffo 不创建积分包产品 | `--payment waffo` 的站点开箱没有积分包可买；要卖的项目自己去 Waffo 后台建并填两个 `VITE_WAFFO_PRODUCT_CREDITS_*` |
| 模板仓库是 private，README 未提 | 当前不面向外部用户 |
| v1.4.0 未发布到 npm | 本地 `dist/` 使用；README 的 `npx @latest` 路径暂不适用 |

## 已解决

- ~~`state.json` 以 0644 保存明文 API token~~ —— **该条目本身是错的**。
  `src/state.ts` 的 `sanitizeStateForDisk` 在每次 `writeState` 落盘前把
  `cloudflareApiToken` 与 `waffoPrivateKey` 置空，读取时从 `process.env` 还原。
  2026-08-25 三档实跑逐个确认磁盘上均为 `""`。
  真正的明文残留在 `.env` / `.env.production`，`delete` 不删它们——README 已补说明。
- ~~端到端只覆盖到文件生成~~ —— 2026-08-25 完成三档（full / account / free）
  真实创建、部署、拆除的完整链路人工验收。结论见模板仓库 `docs/cli-contract.md`。
