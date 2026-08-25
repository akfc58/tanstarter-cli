# 生成器契约 K3–K8 落地计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `tanstarter-cli` 满足模板契约 K3–K8：改写过的文件仍能通过模板的 `biome check`、JSONC 改写无损、生成项目的 `gh` 默认指向自己、teardown 要么删干净要么显式列出残留、凭据注入方式写进文档，并有一条覆盖「clone 真实模板 → 生成文件」的测试兜住这些结论。

**Architecture:** 核心改动是把 `wrangler.jsonc` 的「解析 → 反序列化写回」换成「按字段就地文本编辑」，格式与注释因此天然保留，K3 与 K4 一并解决，且不引入任何运行时依赖。其余各条是小面积增补：`git.ts` 增加 `gh repo set-default`、`delete.ts` 增加手工清理提示。最后一层是集成测试：真实 clone 模板后跑生成函数，用「相对原文件只改了这几行」的差异断言把 K3/K4 钉死，同时覆盖 env 清单文件名这类模板结构假设。

**Tech Stack:** TypeScript 5.7（strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）、Node 20+ ESM（相对导入必须带 `.js` 后缀）、vitest 4、无运行时依赖。

**Spec:** `/Users/luc/dprojects/tanstack-template/docs/cli-contract.md`（模板仓库内 `docs/cli-contract.md`）

## Global Constraints

- **零运行时依赖**：`package.json` 现在没有 `dependencies` 字段，本计划不得新增。K4 不允许引入 `jsonc-parser` 一类的库，必须用就地文本编辑解决。
- **模板是事实来源，且永远 private、不改名**：模板仓库固定为 `https://github.com/akfc58/tanstack-template.git`（`src/constants.ts:3` 的 `DEFAULT_TEMPLATE_URL`）。任何需要模板的测试都用这个常量，不硬编码 URL，也不为「模板变公开」或「模板改名」做兜底。
- **模板结构约定**（依赖它的逻辑必须由集成测试覆盖）：变量清单是 `env.example`（无前导点）、tier 声明在 `src/config/preset.ts`、Worker 配置是 `wrangler.jsonc`。
- **模板侧 `pnpm check` = `biome check && tsc --noEmit && vitest run`**，biome 在链首。生成项目里任何格式错误都会让 tsc 与全部单测跑不到。
- **CLI 侧质量命令**：`pnpm run check`（`tsc --noEmit`）、`pnpm run test`（只跑 `test/index.test.ts`）、`pnpm run build`。CLI 自身没有 biome。
- **代码注释用英文**（与现有代码一致）；commit / PR 描述用中文。
- **分支交付**：全部改动在一个分支上完成，经 PR 合并，禁止直接推 main。
- **失败要响**：模板结构对不上时抛出带修复指引的错误，模仿 `src/template.ts:33-52` 与 `src/env.ts:122-136` 的写法，禁止静默跳过。

## 契约复核备注（实现时不要被误导）

- 契约 K4 的验证命令 `grep -c "nodejs_compat_populate_process_env" wrangler.jsonc` **无效**：那是 `compatibility_flags` 里的字符串值，不是注释，旧实现下也返回 1。本计划改用「注释行数」与「差异行集合」断言。这一点已知会反馈给模板作者。
- 契约 K2/K1 已消解，**不要**为它们写任何代码，尤其不要引入 `E2E_EMAIL_DOMAIN` 一类环境变量。
- 契约允许 Waffo 侧拆除退化为提示（本计划采用该退路）。

---

## File Structure

| 文件 | 职责 | 本次动作 |
|---|---|---|
| `src/wrangler-config.ts` | `wrangler.jsonc` 的就地字段改写与自检 | 重写 |
| `src/git.ts` | 生成项目的 git/gh 远程配置 | 增加 `gh repo set-default` |
| `src/delete.ts` | teardown 流程与确认清单 | 确认清单分段 + 手工清理提示 |
| `src/output.ts` | 终端输出格式化 | 增加 `formatManualCleanup` |
| `test/fixtures/wrangler.jsonc` | 单测用的真实模板配置副本 | 新建 |
| `test/index.test.ts` | 单测 | 改写 wrangler 段，增加 teardown 断言 |
| `test/template-integration.test.ts` | 真实模板集成测试 | 新建 |
| `README.md` / `README.zh-CN.md` | 使用文档 | K7 凭据说明 + 模板 URL 对齐 |
| `PUBLISH.md` | 发版流程 | 增加发版前跑集成测试的要求 |
| `docs/known-issues-and-follow-ups.md` | 交接文档 | 更新遗留项 |

---

## Task 1: 真实模板集成测试骨架

先建立守卫，再改代码——契约 K8 的论点就是「这一条不满足，其余几条修完也会重新长回来」。本任务只覆盖当前已经正确的三件事（env 清单、preset 替换、package.json 改名），它们现在就该通过；Task 2 再往这个文件里加会失败的 wrangler 断言。

**Files:**
- Create: `test/template-integration.test.ts`
- Modify: `package.json`（scripts）

模板永远 private，CI 匿名 clone 必失败，所以这条测试**不进 CI**：它是本地命令，发版前必跑（Task 5 会写进 `PUBLISH.md`）。

**Interfaces:**
- Consumes: `DEFAULT_TEMPLATE_URL`（`src/constants.ts`）、`ensureEnvFiles`（`src/env.ts`）、`writePresetConfig` / `updatePackageName`（`src/template.ts`）
- Produces: `pnpm run test:template` 命令；测试内的两个工具函数 `cloneTemplate(targetDir: string): void` 与 `changedLines(before: string, after: string): { removed: string[]; added: string[] }`，Task 2 会复用后者

- [ ] **Step 1: 写集成测试文件**

新建 `test/template-integration.test.ts`：

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATE_URL } from '../src/constants.ts';
import { ensureEnvFiles } from '../src/env.ts';
import { updatePackageName, writePresetConfig } from '../src/template.ts';
import type { RuntimeConfig } from '../src/types.ts';

/**
 * The template repository is private and stays private, so this suite runs
 * with whatever git credentials the machine already has. It is not part of
 * `pnpm test`; run it with `pnpm run test:template`.
 */
const CLONE_TIMEOUT_MS = 180_000;

let templateDir = '';

function cloneTemplate(targetDir: string): void {
  execFileSync(
    'git',
    ['clone', '--depth', '1', DEFAULT_TEMPLATE_URL, targetDir],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
}

/** Lines present on one side only. Order-insensitive on purpose. */
export function changedLines(
  before: string,
  after: string
): { removed: string[]; added: string[] } {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  return {
    removed: beforeLines.filter((line) => !afterLines.includes(line)),
    added: afterLines.filter((line) => !beforeLines.includes(line)),
  };
}

function createConfigFor(targetDir: string): RuntimeConfig {
  return {
    projectName: 'qa-regression',
    targetDir,
    domain: '',
    githubRepo: 'qa-regression',
    cloudflareAccountId: 'account-id',
    cloudflareApiToken: 'api-token',
    d1DatabaseName: 'qa-regression',
    d1DatabaseId: '11111111-2222-3333-4444-555555555555',
    r2BucketName: 'qa-regression',
    kvNamespaceName: 'qa-regression',
    kvNamespaceId: '0123456789abcdef0123456789abcdef',
    preset: 'account',
    paymentProvider: 'none',
    waffoSetupId: 'setup-test-id',
    waffoMerchantId: '',
    waffoPrivateKey: '',
    waffoStoreName: 'QA Store',
    waffoStoreId: '',
    waffoProductIds: { proMonthly: '', proYearly: '', lifetime: '' },
    waffoWebhookId: '',
  };
}

describe('generated files against the real template', () => {
  beforeAll(() => {
    templateDir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-template-')),
      'project'
    );
    cloneTemplate(templateDir);
  }, CLONE_TIMEOUT_MS);

  it('seeds every variable the template manifest declares', () => {
    const config = createConfigFor(templateDir);

    ensureEnvFiles(config);

    const manifest = fs.readFileSync(
      path.join(templateDir, 'env.example'),
      'utf8'
    );
    const declaredKeys = [...manifest.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map(
      (match) => match[1]
    );
    expect(declaredKeys.length).toBeGreaterThan(40);

    for (const envFile of ['.env', '.env.production']) {
      const content = fs.readFileSync(
        path.join(templateDir, envFile),
        'utf8'
      );
      const presentKeys = new Set(
        [...content.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map(
          (match) => match[1]
        )
      );
      const missing = declaredKeys.filter((key) => !presentKeys.has(key));
      expect(missing).toEqual([]);
    }
  });

  it('rewrites only the ACTIVE_PRESET line of the preset module', () => {
    const presetPath = path.join(templateDir, 'src', 'config', 'preset.ts');
    const before = fs.readFileSync(presetPath, 'utf8');

    writePresetConfig(createConfigFor(templateDir));

    const after = fs.readFileSync(presetPath, 'utf8');
    const { removed, added } = changedLines(before, after);
    expect(removed).toHaveLength(1);
    expect(added).toEqual([
      "export const ACTIVE_PRESET: PresetName = 'account';",
    ]);
  });

  it('rewrites only the name field of package.json', () => {
    const packagePath = path.join(templateDir, 'package.json');
    const before = fs.readFileSync(packagePath, 'utf8');

    updatePackageName(createConfigFor(templateDir));

    const after = fs.readFileSync(packagePath, 'utf8');
    const { removed, added } = changedLines(before, after);
    expect(removed).toEqual(['  "name": "tanstack-template",']);
    expect(added).toEqual(['  "name": "qa-regression",']);
  });
});
```

- [ ] **Step 2: 加 script**

`package.json` 的 `scripts` 里加一行（放在 `test` 后面）：

```json
    "test:template": "vitest run test/template-integration.test.ts",
```

- [ ] **Step 3: 跑测试，确认三条全绿**

Run: `pnpm run test:template`
Expected: 3 passed。若 clone 失败，先确认本机 `git ls-remote https://github.com/akfc58/tanstack-template.git HEAD` 能通（模板是 private，靠本机凭据）。

- [ ] **Step 4: 跑 CLI 自身的检查**

Run: `pnpm run check && pnpm run test`
Expected: 全部通过（本任务没动 `src/`）。

- [ ] **Step 5: Commit**

```bash
git add test/template-integration.test.ts package.json
git commit -m "test: 增加针对真实模板的生成文件集成测试"
```

---

## Task 2: K3 + K4 — `wrangler.jsonc` 就地改写

契约 K3（格式）与 K4（无损）是同一个根因：`JSON.parse` + `JSON.stringify` 的有损往返。改成只替换需要改的值之后，未触碰的行逐字节保持原样，格式问题自然消失，不需要再调 `biome format`，也就不依赖 `install` 步骤的先后。

**Files:**
- Modify: `src/wrangler-config.ts`（整文件重写，保留导出的 `stripJsonc`）
- Create: `test/fixtures/wrangler.jsonc`
- Modify: `test/index.test.ts:418-485`（`describe('wrangler config writing')` 整段替换）
- Modify: `test/template-integration.test.ts`（新增两条 wrangler 断言）

**Interfaces:**
- Consumes: `RuntimeConfig`（`src/types.ts:25`）、`WranglerConfig`（`src/types.ts:56`）、Task 1 的 `changedLines`
- Produces: `writeWranglerConfig(config: RuntimeConfig): void`（签名不变）、`stripJsonc(content: string): string`（签名不变，`test/index.test.ts` 与自检逻辑都在用）

- [ ] **Step 1: 准备真实模板 fixture**

单测需要一个带注释的真实配置。从模板检出逐字节复制：

```bash
mkdir -p test/fixtures
cp /Users/luc/dprojects/tanstack-template/wrangler.jsonc test/fixtures/wrangler.jsonc
```

若本机没有模板检出，就从临时 clone 里复制：

```bash
tmp=$(mktemp -d) && git clone --depth 1 https://github.com/akfc58/tanstack-template.git "$tmp/t" \
  && cp "$tmp/t/wrangler.jsonc" test/fixtures/wrangler.jsonc && rm -rf "$tmp"
```

这个 fixture 只为单测提速；它会不会跟模板漂移，由 Task 1/本任务 Step 6 的集成测试兜底——这正是契约 K8 指出的根因，不要反过来只靠 fixture。

- [ ] **Step 2: 写失败的单测**

把 `test/index.test.ts` 里 `describe('wrangler config writing', ...)` 整段（第 418 行到该 describe 结束的第 485 行）替换为：

```ts
const WRANGLER_FIXTURE = fs.readFileSync(
  path.join(import.meta.dirname, 'fixtures', 'wrangler.jsonc'),
  'utf8'
);

function seedWranglerFixture(targetDir: string): string {
  const wranglerPath = path.join(targetDir, 'wrangler.jsonc');
  fs.writeFileSync(wranglerPath, WRANGLER_FIXTURE, 'utf8');
  return wranglerPath;
}

describe('wrangler config writing', () => {
  it('keeps the template comments and single-line arrays', () => {
    const config = createTestConfig({ domain: 'app.example.com' });
    const wranglerPath = seedWranglerFixture(config.targetDir);

    writeWranglerConfig(config);

    const content = fs.readFileSync(wranglerPath, 'utf8');
    expect(content).toContain('// Enable auto-populating process.env');
    expect(content).toContain(
      '// Daily credits expiry (UTC midnight). See src/credits/expire.ts'
    );
    // The re-wrapped crons array is what biome rejected after the old
    // JSON.stringify round trip.
    expect(content).toContain('"crons": ["0 0 * * *"]');
  });

  it('writes D1, R2, KV, and custom domain settings', () => {
    const config = createTestConfig({ domain: 'app.example.com' });
    const wranglerPath = seedWranglerFixture(config.targetDir);

    writeWranglerConfig(config);

    const wranglerConfig = JSON.parse(
      stripJsonc(fs.readFileSync(wranglerPath, 'utf8'))
    );

    expect(wranglerConfig).toMatchObject({
      name: 'demo-app',
      routes: [{ pattern: 'app.example.com', custom_domain: true }],
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'demo-app-db',
          database_id: 'database-id',
          migrations_dir: './src/db/migrations',
        },
      ],
      r2_buckets: [{ binding: 'BUCKET', bucket_name: 'demo-app-bucket' }],
      kv_namespaces: [
        { binding: 'CACHE', id: '0123456789abcdef0123456789abcdef' },
      ],
    });
  });

  it('comments out the routes block when no domain is given', () => {
    const config = createTestConfig();
    const wranglerPath = seedWranglerFixture(config.targetDir);

    writeWranglerConfig(config);

    const content = fs.readFileSync(wranglerPath, 'utf8');
    expect(JSON.parse(stripJsonc(content)).routes).toBeUndefined();
    expect(content).toContain('Custom domains are disabled by TanStarter CLI.');
    expect(content).not.toContain('tanstack-template.fishwiththemoon.uk');
  });

  it('is a no-op when rerun with the same options', () => {
    const config = createTestConfig();
    const wranglerPath = seedWranglerFixture(config.targetDir);

    writeWranglerConfig(config);
    const first = fs.readFileSync(wranglerPath, 'utf8');
    writeWranglerConfig(config);

    expect(fs.readFileSync(wranglerPath, 'utf8')).toBe(first);
  });

  it('fails loudly when the template stops declaring a generated field', () => {
    const config = createTestConfig();
    fs.writeFileSync(
      path.join(config.targetDir, 'wrangler.jsonc'),
      WRANGLER_FIXTURE.replace('"bucket_name"', '"bucket_label"'),
      'utf8'
    );

    expect(() => writeWranglerConfig(config)).toThrow(/bucket_name/);
  });
});
```

- [ ] **Step 3: 跑单测，确认按预期失败**

Run: `pnpm run test`
Expected: `keeps the template comments...`、`is a no-op when rerun...`、`fails loudly...` 失败（旧实现丢注释、重排格式、无自检）。

- [ ] **Step 4: 重写 `src/wrangler-config.ts`**

整文件内容。五处值各用一条锚定唯一文本的正则，写完再 parse 自检——**简单匹配 + 一次强校验**，比自己实现括号扫描器可靠也短得多：

```ts
import fs from 'node:fs';
import path from 'node:path';

import type { RuntimeConfig, WranglerConfig } from './types.js';

const DRIFT_HINT =
  'The template changed wrangler.jsonc; update the CLI to match before continuing.';

/** The five values this CLI owns, each anchored on text unique to the file. */
const VALUE_EDITS: Array<{
  label: string;
  pattern: RegExp;
  read: (config: RuntimeConfig) => string;
}> = [
  {
    label: 'name',
    pattern: /^( {2}"name": )"[^"]*"/m,
    read: (config) => config.projectName,
  },
  {
    label: 'database_name',
    pattern: /("database_name": )"[^"]*"/,
    read: (config) => config.d1DatabaseName,
  },
  {
    label: 'database_id',
    pattern: /("database_id": )"[^"]*"/,
    read: (config) => config.d1DatabaseId,
  },
  {
    label: 'bucket_name',
    pattern: /("bucket_name": )"[^"]*"/,
    read: (config) => config.r2BucketName,
  },
  {
    label: 'kv_namespaces id',
    pattern: /("binding": "CACHE",\s*\n\s*"id": )"[^"]*"/,
    read: (config) => config.kvNamespaceId,
  },
];

/** The template's active routes block, key through closing bracket. */
const ROUTES_BLOCK = /^ {2}"routes": \[[\s\S]*?^ {2}\],\n/m;

/**
 * Rewrites the generated project's `wrangler.jsonc` field by field, in place.
 *
 * Parsing and reserializing would be a lossy round trip: every explanatory
 * comment the template author wrote disappears, and untouched blocks come back
 * reformatted. That matters beyond aesthetics — biome sits at the head of the
 * template's `pnpm check`, so a reformatted config costs the generated project
 * its type-check and its whole unit suite, and the template has no CI quality
 * gate to catch it later.
 */
export function writeWranglerConfig(config: RuntimeConfig): void {
  const wranglerPath = path.join(config.targetDir, 'wrangler.jsonc');
  let content = fs.readFileSync(wranglerPath, 'utf8');

  for (const edit of VALUE_EDITS) {
    if (!edit.pattern.test(content)) {
      throw new Error(
        [`Could not find ${edit.label} in wrangler.jsonc.`, DRIFT_HINT].join('\n')
      );
    }
    const value = JSON.stringify(edit.read(config));
    content = content.replace(
      edit.pattern,
      (_match, prefix: string) => `${prefix}${value}`
    );
  }

  content = writeRoutes(content, config.domain);
  assertGeneratedFields(content, config);
  fs.writeFileSync(wranglerPath, content, 'utf8');
}

/**
 * The template ships an active route pointing at the template author's own
 * hostname, so this block always has to change. Without a domain it is
 * commented out rather than deleted: the template's own explanation survives,
 * and a rerun finds no active block and stops, which is what makes the whole
 * rewrite idempotent under `--resume`.
 */
function writeRoutes(content: string, domain: string): string {
  if (!ROUTES_BLOCK.test(content)) {
    if (!domain) return content;
    throw new Error(
      [
        'Could not find an active "routes" block to point at the custom domain.',
        DRIFT_HINT,
      ].join('\n')
    );
  }

  const block = domain ? activeRoutesBlock(domain) : disabledRoutesBlock();
  return content.replace(ROUTES_BLOCK, () => block);
}

function activeRoutesBlock(domain: string): string {
  return [
    '  "routes": [',
    '    {',
    `      "pattern": ${JSON.stringify(domain)},`,
    '      "custom_domain": true',
    '    }',
    '  ],',
    '',
  ].join('\n');
}

function disabledRoutesBlock(): string {
  return [
    '  // Custom domains are disabled by TanStarter CLI.',
    '  // Pass --domain example.com to enable routes.',
    '  // "routes": [',
    '  //   { "pattern": "example.com", "custom_domain": true }',
    '  // ],',
    '',
  ].join('\n');
}

/**
 * Text edits can silently miss a field the template renamed. Parse the result
 * and confirm every generated value landed, so drift fails here instead of
 * surfacing as a Worker deployed against the template author's resources.
 */
function assertGeneratedFields(content: string, config: RuntimeConfig): void {
  const parsed = JSON.parse(stripJsonc(content)) as WranglerConfig;
  const expected: Record<string, string | undefined> = {
    name: config.projectName,
    'd1_databases[0].database_name': config.d1DatabaseName,
    'd1_databases[0].database_id': config.d1DatabaseId,
    'r2_buckets[0].bucket_name': config.r2BucketName,
    'kv_namespaces[0].id': config.kvNamespaceId,
    'routes[0].pattern': config.domain || undefined,
  };
  const actual: Record<string, string | undefined> = {
    name: parsed.name,
    'd1_databases[0].database_name': parsed.d1_databases?.[0]?.database_name,
    'd1_databases[0].database_id': parsed.d1_databases?.[0]?.database_id,
    'r2_buckets[0].bucket_name': parsed.r2_buckets?.[0]?.bucket_name,
    'kv_namespaces[0].id': parsed.kv_namespaces?.[0]?.id,
    'routes[0].pattern': parsed.routes?.[0]?.pattern,
  };

  const problems = Object.keys(expected).filter(
    (field) => actual[field] !== expected[field]
  );
  if (problems.length > 0) {
    throw new Error(
      [
        `wrangler.jsonc was rewritten but these fields did not take effect: ${problems.join(', ')}.`,
        DRIFT_HINT,
      ].join('\n')
    );
  }
}

export function stripJsonc(content: string): string {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    const next = content[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < content.length && content[index] !== '\n') index++;
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (
        index < content.length &&
        !(content[index] === '*' && content[index + 1] === '/')
      ) {
        index++;
      }
      index++;
      continue;
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, '$1');
}
```

`stripJsonc` 原样保留（`test/index.test.ts` 与自检都在用）。注意两点：`--resume` 时 `readState` 是 `{...fallbackConfig, ...state.config}`，state 覆盖入参，所以「先无域名、后加 `--domain`」在实际流程里不可达，`writeRoutes` 对这条路径直接抛错即可，不需要再写一个匹配注释块的正则。
- [ ] **Step 5: 跑单测与类型检查**

Run: `pnpm run check && pnpm run test`
Expected: 全部通过。

- [ ] **Step 6: 往集成测试加 wrangler 断言**

在 `test/template-integration.test.ts` 顶部 import 里加上 `import { writeWranglerConfig } from '../src/wrangler-config.ts';`，并在 describe 内追加：

```ts
  it('rewrites wrangler.jsonc without disturbing comments or formatting', () => {
    const wranglerPath = path.join(templateDir, 'wrangler.jsonc');
    const before = fs.readFileSync(wranglerPath, 'utf8');

    writeWranglerConfig(createConfigFor(templateDir));

    const after = fs.readFileSync(wranglerPath, 'utf8');
    const { removed } = changedLines(before, after);
    for (const line of removed) {
      expect(line).toMatch(
        /"(name|pattern|custom_domain|routes|database_name|database_id|bucket_name|id)"|^ {2,4}[[\]{}],?$/
      );
    }

    const commentLinesBefore = before
      .split('\n')
      .filter((line) => line.trim().startsWith('//')).length;
    const commentLinesAfter = after
      .split('\n')
      .filter((line) => line.trim().startsWith('//')).length;
    expect(commentLinesAfter).toBeGreaterThanOrEqual(commentLinesBefore);
  });

  it('points the generated Worker at the project resources', () => {
    const config = createConfigFor(templateDir);
    writeWranglerConfig(config);

    const parsed = JSON.parse(
      stripJsonc(fs.readFileSync(path.join(templateDir, 'wrangler.jsonc'), 'utf8'))
    );
    expect(parsed.name).toBe('qa-regression');
    expect(parsed.routes).toBeUndefined();
    expect(parsed.d1_databases[0].database_id).toBe(
      '11111111-2222-3333-4444-555555555555'
    );
    expect(parsed.kv_namespaces[0].id).toBe(
      '0123456789abcdef0123456789abcdef'
    );
  });
```

`stripJsonc` 也要加进那条 import。注意这两条断言依赖上一条 `it` 已经写过文件——`writeWranglerConfig` 幂等，重复调用安全。

- [ ] **Step 7: 跑集成测试**

Run: `pnpm run test:template`
Expected: 5 passed。

- [ ] **Step 8: Commit**

```bash
git add src/wrangler-config.ts test/fixtures/wrangler.jsonc test/index.test.ts test/template-integration.test.ts
git commit -m "fix(wrangler): 就地改写 wrangler.jsonc，保留注释与格式"
```

---

## Task 3: K5 — 让 `gh` 默认指向生成项目

`gh` 的 fork 启发式只要看到名为 `upstream` 的 remote 就把它当 base repo，于是 `gh run list` / `gh pr list` / `gh secret list` 全部打到模板仓库。修法是写入 `remote.origin.gh-resolved = base`，即 `gh repo set-default`——非破坏性，`upstream` 远程照旧保留（它是拉取模板后续修复的唯一通道）。

**Files:**
- Modify: `src/git.ts:61-96`

单测覆盖不了这条：真实 `gh` 不能在测试里调，而给 PATH 塞一个假 `gh` 只是在断言我们自己写的桩。K5 的验收就用契约给的那条命令，在人工 QA 里跑。

**Interfaces:**
- Consumes: `runInheritedRaw`（`src/commands.ts:81`）、`RuntimeConfig`
- Produces: `createGithubRepo(config: RuntimeConfig): RuntimeConfig`（签名不变，行为增加 set-default）

- [ ] **Step 1: 实现**

`src/git.ts` 里把 `createGithubRepo` 改成先算出 config、最后统一 set-default：

```ts
export function createGithubRepo(config: RuntimeConfig): RuntimeConfig {
  const nextConfig = connectGithubRepo(config);
  setDefaultGithubRepo(nextConfig);
  return nextConfig;
}

function connectGithubRepo(config: RuntimeConfig): RuntimeConfig {
  if (gitRemoteExists(config.targetDir, 'origin')) {
    console.log('Git remote origin already exists; skipping repo creation.');
    return {
      ...config,
      githubRepoUrl: getGithubRepoWebUrl(config.githubRepo, config.targetDir),
    };
  }

  const repo = config.githubRepo;
  const viewResult = spawnSync('gh', ['repo', 'view', repo], {
    cwd: config.targetDir,
    stdio: 'ignore',
  });

  if (viewResult.status === 0) {
    const remoteUrl = getGithubRepoUrl(repo, config.targetDir);
    runInheritedRaw(
      'git',
      ['remote', 'add', 'origin', remoteUrl],
      config.targetDir
    );
    return { ...config, githubRepoUrl: remoteUrl.replace(/\.git$/, '') };
  }

  runInheritedRaw(
    'gh',
    ['repo', 'create', repo, '--private', '--source=.', '--remote=origin'],
    config.targetDir
  );

  return {
    ...config,
    githubRepoUrl: getGithubRepoWebUrl(repo, config.targetDir),
  };
}

/**
 * `gh` treats any remote named `upstream` as the fork parent, so without this
 * every `gh run list` / `gh pr list` / `gh secret list` in the generated
 * project would report on the template repository instead. Writing
 * `remote.origin.gh-resolved` keeps the upstream remote — the channel for
 * pulling template fixes — while pointing gh at the project itself.
 */
function setDefaultGithubRepo(config: RuntimeConfig): void {
  const nameWithOwner = getGithubRepoNameWithOwner(
    config.githubRepo,
    config.targetDir
  );
  runInheritedRaw(
    'gh',
    ['repo', 'set-default', nameWithOwner],
    config.targetDir
  );
}

function getGithubRepoNameWithOwner(repo: string, cwd: string): string {
  const result = spawnSync(
    'gh',
    ['repo', 'view', repo, '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  );

  if (
    result.status !== 0 ||
    typeof result.stdout !== 'string' ||
    result.stdout.trim() === ''
  ) {
    throw new Error(
      `Could not resolve the owner/name of GitHub repo ${repo}.`
    );
  }

  return result.stdout.trim();
}
```

`config.githubRepo` 可能是不带 owner 的裸名（`src/config.ts:42`），所以必须经 `gh repo view --json nameWithOwner` 解析后再传给 `set-default`。

- [ ] **Step 2: 跑测试**

Run: `pnpm run check && pnpm run test`
Expected: 全部通过（现有测试不应因这次改动而变红）。

- [ ] **Step 3: Commit**

```bash
git add src/git.ts
git commit -m "fix(git): 生成项目写入 gh-resolved，避免 gh 默认打到模板仓库"
```

---

## Task 4: K6 — 说清拆掉了什么，并加一道防误删关口

teardown 现在删五样，确认清单却读起来像是连 Waffo 一起处理了。契约的原话是「列出来但不做，比不列更容易误导」，所以这里不加删除动作，而是把「会删」和「不会删」在确认时就分开，并在结束时把删不掉的东西连同 ID 一起打出来。

同时补一道**二次确认**：现在只需要输入一次 `delete`，而这个词是跑过一遍的人会条件反射打出来的。删除不可逆，所以第一关过后再问一次，必须精确输入 `yes` 才继续，**其余任何输入（含空回车、`y`、`YES`）一律终止**。第二问带上项目名，让最后一眼看到的是要删的东西。

**自定义域名不单独解绑**：`wrangler delete` 的文档写的是「Delete your Worker and all associated Cloudflare developer platform resources」，Worker 删除后其 custom domain 绑定随之释放，CLI 不再重复调 API。确认清单里保留域名一行，但措辞改成「随 Worker 一并释放」，不让它读起来像一个独立的删除步骤。

**Files:**
- Modify: `src/output.ts`
- Modify: `src/delete.ts`
- Modify: `test/index.test.ts`

**Interfaces:**
- Consumes: `RuntimeConfig`、`WAFFO_TEMPLATE_PRODUCTS`（`src/waffo.ts`，`src/output.ts` 已经 import）
- Produces: `formatManualCleanup(config: RuntimeConfig): string[]`（`src/output.ts` 导出，返回待打印的行；无残留时返回 `[]`）
- 内部：`confirmDelete` 保持私有，通过 `deleteProject` 测它的取消路径

- [ ] **Step 1: 写失败的测试**

在 `test/index.test.ts` 末尾追加：

```ts
describe('teardown reporting', () => {
  it('lists Waffo resources as manual cleanup when payment is waffo', () => {
    const lines = formatManualCleanup(
      createTestConfig({
        paymentProvider: 'waffo',
        waffoStoreId: 'store-1',
        waffoWebhookId: 'hook-1',
        waffoProductIds: {
          proMonthly: 'prod-1',
          proYearly: 'prod-2',
          lifetime: 'prod-3',
        },
      })
    );

    expect(lines.join('\n')).toContain('store-1');
    expect(lines.join('\n')).toContain('hook-1');
    expect(lines.join('\n')).toContain('prod-3');
  });

  it('reports nothing to clean up without a payment provider', () => {
    expect(formatManualCleanup(createTestConfig())).toEqual([]);
  });
});

describe('delete confirmation', () => {
  /**
   * Only the cancelling paths are exercised. A confirmed delete would shell
   * out to Wrangler and gh for real, and every cancel path throws before the
   * first step runs, which is exactly the behaviour worth pinning down.
   */
  async function runCancelledDelete(answers: string[]): Promise<void> {
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', {
      value: stdin,
      configurable: true,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pending = [...answers];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        if (String(chunk).trimEnd().endsWith(':') && pending.length > 0) {
          setImmediate(() => stdin.write(`${pending.shift()}\n`));
        }
        return true;
      }) as typeof process.stdout.write);

    const config = createTestConfig();
    try {
      await deleteProject(
        { command: 'delete', projectName: config.projectName, targetDir: config.targetDir, domain: '', resume: false },
        config
      );
    } finally {
      logSpy.mockRestore();
      writeSpy.mockRestore();
      Object.defineProperty(process, 'stdin', originalStdin);
      stdin.end();
    }
  }

  it('stops at the first gate when the word is not delete', async () => {
    await expect(runCancelledDelete(['nope'])).rejects.toThrow(
      'Delete cancelled.'
    );
  });

  it('stops at the second gate on anything but an exact yes', async () => {
    await expect(runCancelledDelete(['delete', 'y'])).rejects.toThrow(
      'Delete cancelled.'
    );
    await expect(runCancelledDelete(['delete', ''])).rejects.toThrow(
      'Delete cancelled.'
    );
    await expect(runCancelledDelete(['delete', 'YES'])).rejects.toThrow(
      'Delete cancelled.'
    );
  });
});
```

顶部 import 里新增两行：从 `../src/output.ts` 引入 `formatManualCleanup`，从 `../src/delete.ts` 引入 `deleteProject`（两个文件目前都没有被测试引用）。`PassThrough` 与 `vi` 已经在文件顶部导入。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm run test`
Expected: FAIL。`formatManualCleanup` 不存在；`stops at the second gate...` 也会挂——现在只有一道关口，答完 `delete` 就直接开删。

- [ ] **Step 3: 实现手工清理提示**

`src/output.ts` 末尾追加：

```ts
/**
 * Resources teardown cannot remove. Listing something in the "will delete"
 * confirmation and then not deleting it is worse than not listing it at all,
 * so anything that survives has to be named here, with the identifiers needed
 * to find it again.
 */
export function formatManualCleanup(config: RuntimeConfig): string[] {
  if (config.paymentProvider !== 'waffo') return [];

  return [
    `  Waffo store: ${config.waffoStoreId || '(none)'}`,
    ...WAFFO_TEMPLATE_PRODUCTS.map(
      (product) =>
        `  Waffo ${product.name}: ${config.waffoProductIds[product.slot] || '(none)'}`
    ),
    `  Waffo webhook: ${config.waffoWebhookId || '(none)'}`,
  ];
}
```

- [ ] **Step 4: 接进 teardown 流程**

`src/delete.ts` 的 import 里加 `formatManualCleanup`（`./output.js`）。步骤表保持五项不变，在抛错之前打印提示——失败时也要看得到：

```ts
  for (const [index, step] of steps.entries()) {
    printStep(index + 1, steps.length, `Delete ${step.label}`);
    await runDeleteStep(failures, step.label, step.action);
  }

  const manualCleanup = formatManualCleanup(config);
  if (manualCleanup.length > 0) {
    console.log(
      `\nNeeds manual cleanup in the Waffo dashboard:\n${manualCleanup.join('\n')}`
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Some resources could not be deleted: ${failures.join(', ')}`
    );
  }
```

`confirmDelete` 改成明确的两段，域名一行改措辞：

```ts
  console.log('\nTanStarter will delete:');
  console.log(`  Worker: ${config.projectName}`);
  if (config.domain) {
    console.log(
      `  Worker custom domain: ${config.domain} (released with the Worker)`
    );
  }
  console.log(
    `  GitHub repo: ${options.githubRepo || config.githubRepo || config.projectName}`
  );
  console.log(`  D1 database: ${config.d1DatabaseName}`);
  console.log(`  R2 bucket: ${config.r2BucketName}`);
  console.log(`  KV namespace: ${config.kvNamespaceName}`);

  const manualCleanup = formatManualCleanup(config);
  if (manualCleanup.length > 0) {
    console.log('\nTanStarter will NOT delete these:');
    for (const line of manualCleanup) console.log(line);
  }
```

同一个函数里的确认改成两道关口。`delete` 是跑过一遍的人会条件反射打出来的词，而这一步不可逆，所以最后再要一个精确的 `yes`：

```ts
  if (!process.stdin.isTTY) return;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const typed = await rl.question('\nType "delete" to continue: ');
    if (typed.trim() !== 'delete') {
      throw new Error('Delete cancelled.');
    }

    // Second gate. The first word becomes muscle memory for anyone who has
    // run this before, and nothing here can be undone, so the last thing on
    // screen is the project name and an exact answer.
    const confirmed = await rl.question(
      `Permanently delete ${config.projectName} and everything listed above? Type "yes": `
    );
    if (confirmed.trim() !== 'yes') {
      throw new Error('Delete cancelled.');
    }
  } finally {
    rl.close();
  }
```

`yes` 是精确匹配：`y`、`YES`、空回车都终止。非交互终端（`!process.stdin.isTTY`）的行为不变——两道关口都跳过，`delete` 在 CI 或脚本里仍然可用。

- [ ] **Step 5: 跑测试**

Run: `pnpm run check && pnpm run test`
Expected: 全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/delete.ts src/output.ts test/index.test.ts
git commit -m "fix(delete): 确认清单区分会删与不会删，补二次确认防误删"
```

---

## Task 5: K7 — 凭据注入写进文档，并对齐模板 URL

契约 K7 已满足一半（`.env` 按模板清单播种，README 也写了机制）。剩下两点：取值只来自启动时的 `process.env`；有些键由 CLI 自己决定、用户 export 无效。另外 README 里指向模板仓库的 URL 是旧的。

按已确认的取舍：**只改模板 URL 引用**，`package.json` 与 `PUBLISH.md` 里 CLI 自身仓库的 `MkFastHQ` 保持不动；env 清单用**分组摘要 + 指向模板 `env.example`**，不把 50 个键复制进两份 README。

**Files:**
- Modify: `README.md`（Prerequisites 段、What It Does 段）
- Modify: `README.zh-CN.md`（对应两段）
- Modify: `PUBLISH.md`
- Modify: `docs/known-issues-and-follow-ups.md`
- Modify: `package.json`（version）

**Interfaces:**
- Consumes: `src/env.ts:22-25`（CLI 抢占的键清单）、模板 `env.example`（分组依据）
- Produces: 无代码接口

- [ ] **Step 1: README.md 的 Prerequisites 段后追加两小节**

在 `The CLI checks for node, pnpm, git, gh, ...` 那段之后插入：

```markdown
### How third-party credentials reach the generated project

The CLI reads every value from `process.env` **once, when it starts**. It does
not read a `.env` file, does not prompt for these keys, and does not re-read
your shell later in the run. A key you did not `export` before launching ends
up empty in the generated `.env` and `.env.production`, and you only notice
after the site is live — Google sign-in, payments, or Turnstile silently do
nothing.

The full list of variables is the template's
[`env.example`](https://github.com/akfc58/tanstack-template/blob/main/env.example);
the generated env files are seeded from it, so it is the single source of truth.
The ones people usually want set before the first run:

| Area | Variables |
| --- | --- |
| Cloudflare (required) | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Transactional mail | `RESEND_API_KEY` |
| Bot protection | `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| Stripe / Creem payments | `STRIPE_*`, `CREEM_*`, and their `VITE_*_PRICE_*` / `VITE_*_PRODUCT_*` ids |
| Newsletter and notifications | `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`, `DISCORD_WEBHOOK_URL`, `FEISHU_WEBHOOK_URL` |
| Analytics | `VITE_PLAUSIBLE_SCRIPT`, `VITE_UMAMI_SCRIPT`, `VITE_UMAMI_WEBSITE_ID`, `VITE_GOOGLE_ANALYTICS_ID`, `VITE_CLARITY_PROJECT_ID` |
| AI features | `AI_CHAT_PROVIDER`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `AI_COMPAT_*`, `FAL_KEY` |

Anything left empty can be filled in later by editing `.env.production` and
running `pnpm run sync-worker-secrets`.

### Variables the CLI decides for you

Exporting these has no effect — the CLI drops whatever your shell set and writes
its own values:

- `VITE_PAYMENT_PROVIDER`
- `WAFFO_DEBUG`, `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY`, `WAFFO_STORE_ID`,
  `VITE_WAFFO_PRODUCT_PRO_MONTHLY`, `VITE_WAFFO_PRODUCT_PRO_YEARLY`,
  `VITE_WAFFO_PRODUCT_LIFETIME`

(`WAFFO_MERCHANT_ID` and `WAFFO_PRIVATE_KEY` are still read from your shell as
setup credentials with `--payment waffo`; what the CLI controls is the value
written into the generated project.)

Without `--payment waffo`, `VITE_PAYMENT_PROVIDER` is written empty. That is a
site with accounts but no checkout: `/pricing` redirects, `/settings/billing`
is inactive, and payment webhooks do nothing. This is the most common source of
confusion right after the first deployment — set a provider in
`.env.production` and redeploy when you are ready to charge.
```

- [ ] **Step 2: 修 README.md 的模板 URL 与 gh 说明**

把 `The generated repository uses origin ... upstream for https://github.com/MkFastHQ/mkfast-template.git.` 那段改成：

```markdown
The generated repository uses `origin` for your new GitHub repository and
`upstream` for `https://github.com/akfc58/tanstack-template.git`. Because the
template history is preserved, future template updates can use a normal Git
merge instead of reconstructing a common ancestor. The CLI also runs
`gh repo set-default` on your repository, so `gh run list`, `gh pr list`, and
`gh secret list` report on your project instead of resolving to the template
through the `upstream` remote.
```

`What It Does` 的第 12 条改为：`Creates a GitHub repository and pins it as the gh default.`

- [ ] **Step 3: README.zh-CN.md 同步**

在中文 README 的对应位置补同样两小节（标题用「第三方凭据怎么进入生成的项目」和「由 CLI 决定的变量」），并把第 173 行附近的 `https://github.com/MkFastHQ/mkfast-template.git` 改成 `https://github.com/akfc58/tanstack-template.git`，同样补一句 `gh repo set-default` 的说明。两份 README 的表格内容必须一致。

- [ ] **Step 4: PUBLISH.md 增加发版前要求**

在发版前检查清单里加一行：

```markdown
- 发版前在本机跑一次 `pnpm run test:template`。它会真实 clone 模板并校验生成文件，是唯一能发现模板结构漂移（`env.example` 文件名、`preset.ts` 声明、`wrangler.jsonc` 字段）的检查。模板是 private 仓库，CI 拿不到它，这条只能在本地跑。
```

- [ ] **Step 5: 更新交接文档**

`docs/known-issues-and-follow-ups.md`：把更新时间改为 `2026-08-25`，删除「缺少真实创建流程的端到端测试」整节，改为一条更窄的遗留：

```markdown
### 端到端只覆盖到文件生成

`pnpm run test:template` 会真实 clone 模板并校验生成的 `wrangler.jsonc` / `.env` / `preset.ts` / `package.json`，模板结构漂移能被它挡住。但真实创建 Cloudflare 资源、GitHub 仓库、部署与 `delete` 的完整链路仍需人工跑一次，命令见模板仓库 `docs/cli-contract.md` 的 K8 段。
```

- [ ] **Step 6: 版本号**

`package.json` 的 `version` 从 `1.3.3` 改为 `1.4.0`（行为变更 + 新命令，非破坏性）。打 tag 与发布仍按 `PUBLISH.md` 人工执行，本计划不做。

- [ ] **Step 7: 全量验证**

Run: `pnpm run check && pnpm run test && pnpm run test:template && pnpm run build`
Expected: 全部通过。

- [ ] **Step 8: Commit**

```bash
git add README.md README.zh-CN.md PUBLISH.md docs/known-issues-and-follow-ups.md package.json
git commit -m "docs: 说明凭据注入方式与 CLI 自决变量，并对齐模板仓库 URL"
```

---

## 交付

- [ ] **开 PR**

```bash
git push -u origin <branch>
gh pr create --title "按模板契约修复生成器 K3–K8" --body "<中文说明，逐条对应 K3/K4/K5/K6/K7/K8>"
```

- [ ] **盯 CI 与 Kilo Code Review**，按结论逐条处理后再推。
- [ ] **合并目标是 main，需用户手动批准合并。**

## 人工 QA（合并前，需真实凭据，无法自动化）

契约 K8 给的验收脚本，逐条跑并如实记录结果：

```bash
tanstarter create qa-regression --preset account --repo <owner>/qa-regression
cd qa-regression
pnpm check                                                  # K1 + K3：期望 exit 0 且 0 warning
grep -c '^\s*//' wrangler.jsonc                             # K4：期望 ≥ 20（契约里给的 grep 无效，见上文备注）
gh repo view --json nameWithOwner -q .nameWithOwner         # K5：期望返回 <owner>/qa-regression
pnpm e2e 2>&1 | grep -c '\[mail\]'                          # K2：期望 0
tanstarter delete qa-regression                             # K6：确认无残留 route，Waffo 手工清理提示应出现
```

跑之前先 `pnpm run build && npm link`（或 `node dist/index.js`），确保用的是本分支的产物而不是 npm 上的旧版本。

## Self-Review

- **契约覆盖**：K1/K2 已消解不实现（备注段写明）；K3 与 K4 → Task 2；K5 → Task 3；K6 → Task 4；K7 → Task 5；K8 → Task 1 + Task 2 Step 6。已裁决不做的四项（支付 provider 范围、首次部署 base URL、state.json 权限、代问站点名）不在计划内。
- **占位符**：无 TBD / 「类似 Task N」；每个代码步骤都给了可直接落地的完整代码。
- **类型一致性**：`formatManualCleanup` / `setDefaultGithubRepo` / `getGithubRepoNameWithOwner` 在定义处与调用处名称一致；`writeWranglerConfig` 与 `stripJsonc` 签名保持不变，`test/index.test.ts` 现有 import 不受影响。
- **已知风险**：`tsconfig` 开了 `noUncheckedIndexedAccess`，Task 2 的下标访问都按 `T | undefined` 处理（`parsed.d1_databases?.[0]?.x`）。两处覆盖缺口是有意留的，均由人工 QA 兜：K5 没有自动化测试；集成测试不进 CI，靠发版前的本地执行。
