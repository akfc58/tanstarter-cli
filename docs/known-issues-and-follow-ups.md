# 已知问题与后续事项

更新时间：2026-08-23

## 低危遗留（已评估，暂不修复）

### 首次部署把 VITE_BASE_URL 烘成 localhost

deploy 步骤执行时 workers.dev 地址尚未产生，`.env.production` 里 `VITE_BASE_URL` 是兜底的 `http://localhost:3000`。实际可自愈：CI 用 GitHub secret 里已更新的地址重新构建并覆盖部署。

### state.json 以 0644 保存明文 API token

`.tanstarter/state.json` 保存完整的 `cloudflareApiToken`，供 `--resume` 和 `delete` 使用，文件权限 0644。该目录已在 `.gitignore` 内，不进仓库也不上传云端，风险仅限本地文件被带出，例如打包分发、网盘同步、备份工具不遵守 gitignore。

## 待办

### 缺少真实创建流程的端到端测试

单测全部在临时目录上跑单个函数，没有一条覆盖「clone 真实模板 → 生成文件」的链路。env 清单文件名不匹配（模板 `env.example` vs CLI 找 `.env.example`）能长期不被发现，正是因为测试 fixture 自己造了 `.env.example`，固化了错误假设。凡是依赖模板具体文件名/结构的逻辑（env 清单、`src/config/preset.ts`、`wrangler.jsonc`），都有同类风险。

