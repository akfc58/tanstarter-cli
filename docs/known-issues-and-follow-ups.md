# 已知问题与后续事项

更新时间：2026-08-18

## 待办

### `--preset free` 尚未实跑一次真实部署

契约 `tanstack-template/docs/superpowers/plans/2026-08-12-cli-preset-contract.md` 第 4 节要求 `--preset free` 必须实跑一次真实部署，确认 worker 能启动、`/` 与 `/blog` 返回 200。原因是 `free` 是唯一把 auth 整个关掉的档位。CLI 侧已完成单测与错误路径验证，这条实跑会真实创建 Cloudflare 资源和 GitHub 仓库，需要用户确认后执行。

## 低危遗留（已评估，暂不修复）

### 首次部署把 VITE_BASE_URL 烘成 localhost

deploy 步骤执行时 workers.dev 地址尚未产生，`.env.production` 里 `VITE_BASE_URL` 是兜底的 `http://localhost:3000`。实际可自愈：CI 用 GitHub secret 里已更新的地址重新构建并覆盖部署。

### state.json 以 0644 保存明文 API token

`.tanstarter/state.json` 保存完整的 `cloudflareApiToken`，供 `--resume` 和 `delete` 使用，文件权限 0644。该目录已在 `.gitignore` 内，不进仓库也不上传云端，风险仅限本地文件被带出，例如打包分发、网盘同步、备份工具不遵守 gitignore。

