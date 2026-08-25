# 已知问题与后续事项

更新时间：2026-08-25

## 低危遗留（已评估，暂不修复）

### 首次部署把 VITE_BASE_URL 烘成 localhost

deploy 步骤执行时 workers.dev 地址尚未产生，`.env.production` 里 `VITE_BASE_URL` 是兜底的 `http://localhost:3000`。实际可自愈：CI 用 GitHub secret 里已更新的地址重新构建并覆盖部署。

### state.json 以 0644 保存明文 API token

`.tanstarter/state.json` 保存完整的 `cloudflareApiToken`，供 `--resume` 和 `delete` 使用，文件权限 0644。该目录已在 `.gitignore` 内，不进仓库也不上传云端，风险仅限本地文件被带出，例如打包分发、网盘同步、备份工具不遵守 gitignore。

## 待办

### 端到端只覆盖到文件生成

`pnpm run test:template` 会真实 clone 模板并校验生成的 `wrangler.jsonc` / `.env` / `preset.ts` / `package.json`，模板结构漂移能被它挡住。但真实创建 Cloudflare 资源、GitHub 仓库、部署与 `delete` 的完整链路仍需人工跑一次，命令见模板仓库 `docs/cli-contract.md` 的 K8 段。

