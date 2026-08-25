import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATE_URL } from '../src/constants.ts';
import { ensureEnvFiles } from '../src/env.ts';
import { updatePackageName, writePresetConfig } from '../src/template.ts';
import type { RuntimeConfig } from '../src/types.ts';
import { stripJsonc, writeWranglerConfig } from '../src/wrangler-config.ts';

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
function changedLines(
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
});
