# Publishing

This document is for maintainers of `tanstarter-cli`. End users do not need it.

The package is published to npm through GitHub Actions and npm Trusted
Publishing. Do not add an `NPM_TOKEN` secret for normal releases.

## Current Setup

- npm package: `tanstarter-cli`
- GitHub repository: `MkFastHQ/tanstarter-cli`
- Publish workflow: `.github/workflows/publish.yml`
- GitHub environment: `npm`
- npm provenance: enabled with `npm publish --provenance --access public`

The workflow runs only when a semantic version tag is pushed:

```text
v*.*.*
```

Examples: `v0.2.3`, `v1.0.0`.

## Release Checklist

Start from a clean `main` branch:

```bash
git checkout main
git pull
git status
```

Run local verification:

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run build
npm pack --dry-run
```

- 发版前在本机跑一次 `pnpm run test:template`。它会真实 clone 模板并校验生成文件，是唯一能发现模板结构漂移（`env.example` 文件名、`preset.ts` 声明、`wrangler.jsonc` 字段）的检查。模板是 private 仓库，CI 拿不到它，这条只能在本地跑。

`package.json` should already carry the version to release — bump it with
`npm version patch` (or `minor`/`major` for larger changes) in its own commit
beforehand if it doesn't yet. Tag that version and push it:

```bash
git tag "v$(node -p "require('./package.json').version")"
git push --follow-tags
```

The tag push triggers the publish workflow. Watch it with:

```bash
gh run list --repo MkFastHQ/tanstarter-cli --limit 5
```

## Verify the Release

After the workflow succeeds:

```bash
npm view tanstarter-cli version versions --json
gh release list --repo MkFastHQ/tanstarter-cli --limit 5
```

Install smoke test:

```bash
npx tanstarter-cli@latest --version
```
