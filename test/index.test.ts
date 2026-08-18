import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/args.ts';
import {
  buildR2ObjectPath,
  buildR2ObjectsPath,
  ensureWorkerCustomDomain,
  parseD1DatabaseId,
  parseKVNamespaceId,
} from '../src/cloudflare.ts';
import { runCommand, shellForPlatform } from '../src/commands.ts';
import { createConfig } from '../src/config.ts';
import { DEFAULT_TEMPLATE_URL } from '../src/constants.ts';
import { ensureEnvFiles, formatEnvValue } from '../src/env.ts';
import { getPublicBaseUrl, verifyPublicDeployment } from '../src/deployment.ts';
import { initializeGit } from '../src/git.ts';
import { isCliEntrypoint } from '../src/index.ts';
import { getInstallPlan } from '../src/preflight.ts';
import { configureSetup, formatDefaultGithubRepo } from '../src/prompt.ts';
import { readExistingState, readState, writeState } from '../src/state.ts';
import { writePresetConfig } from '../src/template.ts';
import type { CliOptions, RuntimeConfig } from '../src/types.ts';
import {
  normalizeSlug,
  normalizeDomain,
  validateDomain,
  validateGithubRepo,
  validateSlug,
} from '../src/validators.ts';
import { stripJsonc, writeWranglerConfig } from '../src/wrangler-config.ts';
import {
  buildWaffoCanonicalRequest,
  buildWaffoWebhookUrl,
  createWaffoProduct,
  createWaffoStore,
  formatWaffoPrice,
  addWaffoWebhook,
  normalizePemForEnv,
  normalizePemForCrypto,
  signWaffoRequest,
  verifyWaffoWebhookEndpoint,
  WAFFO_TEMPLATE_PRODUCTS,
  waffoStoreNameForProject,
  WAFFO_WEBHOOK_EVENTS,
} from '../src/waffo.ts';

function createTestConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    projectName: 'demo-app',
    targetDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-test-')),
    domain: '',
    githubRepo: 'demo-app',
    cloudflareAccountId: 'account-id',
    cloudflareApiToken: 'api-token',
    d1DatabaseName: 'demo-app-db',
    d1DatabaseId: 'database-id',
    r2BucketName: 'demo-app-bucket',
    kvNamespaceName: 'demo-app-kv',
    kvNamespaceId: '0123456789abcdef0123456789abcdef',
    preset: 'full',
    paymentProvider: 'none',
    waffoSetupId: 'setup-test-id',
    waffoMerchantId: '',
    waffoPrivateKey: '',
    waffoStoreName: 'Demo Store',
    waffoStoreId: '',
    waffoProductIds: {
      proMonthly: '',
      proYearly: '',
      lifetime: '',
    },
    waffoWebhookId: '',
    ...overrides,
  };
}

const { privateKey: testPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const testPrivateKeyPem = testPrivateKey.export({
  type: 'pkcs8',
  format: 'pem',
}) as string;

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe('parseArgs', () => {
  it('parses create without a project name for interactive prompts', () => {
    const options = parseArgs(['create']);

    expect(options).toMatchObject({
      command: 'create',
      projectName: '',
      targetDir: '',
      resume: false,
    });
  });

  it('normalizes an optional create project name and applies defaults', () => {
    const options = parseArgs(['create', 'My App']);

    expect(options.command).toBe('create');
    expect(options.projectName).toBe('my-app');
    expect(options.targetDir).toBe(`${process.cwd()}/my-app`);
    expect(options.resume).toBe(false);
  });

  it('parses supported option values and boolean flags', () => {
    const options = parseArgs([
      'create',
      'demo-app',
      '--domain=demo.example.com',
      '--repo',
      'mkfasthq/demo-app',
      '--resume',
    ]);

    expect(options).toMatchObject({
      projectName: 'demo-app',
      domain: 'demo.example.com',
      githubRepo: 'mkfasthq/demo-app',
      resume: true,
    });
    expect(options.targetDir).toBe(`${process.cwd()}/demo-app`);
  });

  it('parses the delete command', () => {
    const options = parseArgs(['delete', 'demo-app']);

    expect(options).toMatchObject({
      command: 'delete',
      projectName: 'demo-app',
    });
  });

  it('parses the payment option and rejects invalid values', () => {
    expect(parseArgs(['create', 'demo-app', '--payment', 'waffo'])).toMatchObject({
      payment: 'waffo',
    });
    expect(parseArgs(['create', 'demo-app', '--payment=none'])).toMatchObject({
      payment: 'none',
    });
    expect(() => parseArgs(['create', 'demo-app', '--payment', 'stripe'])).toThrow(
      '--payment must be none or waffo.'
    );
  });

  it('parses the preset option and rejects invalid values', () => {
    expect(parseArgs(['create', 'demo-app', '--preset', 'free'])).toMatchObject({
      preset: 'free',
    });
    expect(parseArgs(['create', 'demo-app', '--preset=account'])).toMatchObject({
      preset: 'account',
    });
    expect(parseArgs(['create', 'demo-app'])).not.toHaveProperty('preset');
    expect(() => parseArgs(['create', 'demo-app', '--preset', 'pro'])).toThrow(
      'Preset must be one of: free, account, full.'
    );
  });

  it('rejects unknown flags, missing commands, and misplaced commands', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown option: --unknown');
    expect(() => parseArgs([])).toThrow('Command is required.');
    expect(() => parseArgs(['demo-app'])).toThrow('Command is required.');
    expect(() => parseArgs(['delete'])).toThrow(
      'Project name is required for delete.'
    );
    expect(() => parseArgs(['create', 'demo-app', 'delete'])).toThrow(
      'delete must be the first positional argument.'
    );
  });

  it('requires a project name when resuming create', () => {
    expect(() => parseArgs(['create', '--resume'])).toThrow(
      'Project name is required when using --resume.'
    );
  });
});

describe('validation helpers', () => {
  it('normalizes slugs consistently', () => {
    expect(normalizeSlug('  Hello, TanStarter!!  ')).toBe('hello-tanstarter');
    expect(normalizeSlug('A---B___C')).toBe('a-b-c');
  });

  it('validates slug shape', () => {
    expect(() => validateSlug('abc', 'project name')).not.toThrow();
    expect(() => validateSlug('ab', 'project name')).toThrow(
      'project name must be 3-63 chars'
    );
    expect(() => validateSlug('-abc', 'project name')).toThrow(
      'project name must be 3-63 chars'
    );
  });

  it('validates simple domain names', () => {
    expect(() => validateDomain('app.example.com')).not.toThrow();
    expect(() => validateDomain('-bad.example.com')).toThrow(
      '--domain must be a valid domain name.'
    );
  });

  it('validates GitHub repo names', () => {
    expect(() => validateGithubRepo('demo-app')).not.toThrow();
    expect(() => validateGithubRepo('mkfasthq/demo-app')).not.toThrow();
    expect(() => validateGithubRepo('mkfasthq/demo/app')).toThrow(
      '--repo must be a GitHub repo name or owner/name.'
    );
  });
});

describe('wrangler output parsing', () => {
  it('parses D1 database ids from JSON-like and plain output', () => {
    const id = '12345678-1234-1234-1234-123456789abc';

    expect(parseD1DatabaseId(`"database_id": "${id}"`)).toBe(id);
    expect(parseD1DatabaseId(`Created database ${id}`)).toBe(id);
  });

  it('parses KV namespace ids from JSON-like and plain output', () => {
    const id = '0123456789abcdef0123456789abcdef';

    expect(parseKVNamespaceId(`id = "${id}"`)).toBe(id);
    expect(parseKVNamespaceId(`namespace ${id} created`)).toBe(id);
  });
});

describe('Cloudflare API helpers', () => {
  it('builds R2 object paths with encoded bucket and object keys', () => {
    const config = createTestConfig({
      cloudflareAccountId: 'abc123',
      r2BucketName: 'demo bucket',
    });

    expect(buildR2ObjectsPath(config)).toBe(
      '/accounts/abc123/r2/buckets/demo%20bucket/objects'
    );
    expect(buildR2ObjectPath(config, 'avatars/user 1/你好.png')).toBe(
      '/accounts/abc123/r2/buckets/demo%20bucket/objects/avatars%2Fuser%201%2F%E4%BD%A0%E5%A5%BD.png'
    );
  });

  it('attaches a custom domain to the matching Cloudflare zone', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });

        if (url.includes('/zones?')) {
          return Response.json({
            success: true,
            result: [
              { id: 'zone-id', name: 'example.com' },
              { id: 'parent-zone-id', name: 'com' },
            ],
          });
        }
        if (url.includes('/workers/domains?')) {
          return Response.json({ success: true, result: [] });
        }
        return Response.json({
          success: true,
          result: {
            hostname: 'app.example.com',
            service: 'demo-app',
            enabled: true,
          },
        });
      })
    );

    await expect(
      ensureWorkerCustomDomain(
        createTestConfig({ domain: 'app.example.com' })
      )
    ).resolves.toBeUndefined();

    const attachCall = calls.find(
      (call) => call.init.method === 'PUT'
    );
    expect(attachCall).toBeDefined();
    expect(JSON.parse(String(attachCall?.init.body))).toEqual({
      hostname: 'app.example.com',
      service: 'demo-app',
      zone_id: 'zone-id',
      zone_name: 'example.com',
    });
    vi.unstubAllGlobals();
  });
});

describe('file content helpers', () => {
  it('strips JSONC comments and trailing commas', () => {
    const jsonc = `{
      // comment
      "name": "demo",
      "nested": {
        "enabled": true,
      },
    }`;

    expect(JSON.parse(stripJsonc(jsonc))).toEqual({
      name: 'demo',
      nested: { enabled: true },
    });
  });

  it('quotes env values and escapes single quotes', () => {
    expect(formatEnvValue("that's fine")).toBe("'that\\'s fine'");
  });

  it('keeps local env base URL on localhost', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-env-'));
    fs.writeFileSync(
      path.join(tempDir, '.env.example'),
      'VITE_BASE_URL=\nBETTER_AUTH_SECRET=\n',
      'utf8'
    );

    ensureEnvFiles({
      ...createTestConfig(),
      targetDir: tempDir,
      domain: 'app.example.com',
    });

    expect(fs.readFileSync(path.join(tempDir, '.env'), 'utf8')).toContain(
      "VITE_BASE_URL='http://localhost:3000'"
    );
    expect(
      fs.readFileSync(path.join(tempDir, '.env.production'), 'utf8')
    ).toContain("VITE_BASE_URL='https://app.example.com'");
  });

  it('uses deploymentUrl for production env when no custom domain is set', () => {
    const config = createTestConfig({
      deploymentUrl: 'https://demo-app.example.workers.dev',
    });
    fs.writeFileSync(path.join(config.targetDir, '.env.example'), '', 'utf8');

    ensureEnvFiles(config);

    expect(
      fs.readFileSync(path.join(config.targetDir, '.env.production'), 'utf8')
    ).toContain("VITE_BASE_URL='https://demo-app.example.workers.dev'");
  });
});

describe('wrangler config writing', () => {
  it('writes D1, R2, KV, and custom domain settings', () => {
    const config = createTestConfig({ domain: 'app.example.com' });
    fs.writeFileSync(
      path.join(config.targetDir, 'wrangler.jsonc'),
      `{
        // existing template setting
        "compatibility_date": "2026-07-04",
      }`,
      'utf8'
    );

    writeWranglerConfig(config);

    const wranglerConfig = JSON.parse(
      stripJsonc(fs.readFileSync(path.join(config.targetDir, 'wrangler.jsonc'), 'utf8'))
    );

    expect(wranglerConfig).toMatchObject({
      compatibility_date: '2026-07-04',
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
      r2_buckets: [
        {
          binding: 'BUCKET',
          bucket_name: 'demo-app-bucket',
        },
      ],
      kv_namespaces: [
        {
          binding: 'CACHE',
          id: '0123456789abcdef0123456789abcdef',
        },
      ],
    });
  });

  it('removes active routes and leaves commented guidance without a domain', () => {
    const config = createTestConfig();
    fs.writeFileSync(
      path.join(config.targetDir, 'wrangler.jsonc'),
      JSON.stringify({
        routes: [{ pattern: 'old.example.com', custom_domain: true }],
      }),
      'utf8'
    );

    writeWranglerConfig(config);

    const content = fs.readFileSync(
      path.join(config.targetDir, 'wrangler.jsonc'),
      'utf8'
    );
    const wranglerConfig = JSON.parse(stripJsonc(content));

    expect(wranglerConfig.routes).toBeUndefined();
    expect(content).toContain('Custom domains are disabled by TanStarter CLI.');
  });
});

describe('command runner', () => {
  it('uses the shell on Windows so .cmd shims can be resolved from PATH', () => {
    expect(shellForPlatform('win32')).toBe(true);
    expect(shellForPlatform('darwin')).toBe(false);
    expect(shellForPlatform('linux')).toBe(false);
  });

  it('prints the command and injects Cloudflare environment variables', () => {
    const config = createTestConfig();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const result = runCommand(
        process.execPath,
        [
          '-e',
          'console.log(`${process.env.CLOUDFLARE_ACCOUNT_ID}:${process.env.CLOUDFLARE_DATABASE_ID}`)',
        ],
        config
      );

      expect(result.stdout.trim()).toBe('account-id:database-id');
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('💻 $')
      );
    } finally {
      log.mockRestore();
    }
  });

  it('surfaces the spawn failure reason when a command cannot start', () => {
    const config = createTestConfig();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(() =>
        runCommand('tanstarter-nonexistent-binary', ['--version'], config)
      ).toThrow(/ENOENT|spawn/i);
    } finally {
      log.mockRestore();
    }
  });
});

describe('Git initialization', () => {
  it('preserves template history and renames its remote to upstream', () => {
    const targetDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tanstarter-git-')
    );
    runGit(targetDir, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(targetDir, 'README.md'), '# Template\n', 'utf8');
    fs.writeFileSync(path.join(targetDir, '.gitignore'), 'node_modules\n', 'utf8');
    runGit(targetDir, ['add', '.']);
    runGit(targetDir, [
      '-c',
      'user.name=TanStarter Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'template base',
    ]);
    const templateHead = runGit(targetDir, ['rev-parse', 'HEAD']);
    runGit(targetDir, ['remote', 'add', 'origin', DEFAULT_TEMPLATE_URL]);

    initializeGit(targetDir);

    expect(runGit(targetDir, ['rev-parse', 'HEAD'])).toBe(templateHead);
    expect(runGit(targetDir, ['remote'])).toBe('upstream');
    expect(runGit(targetDir, ['remote', 'get-url', 'upstream'])).toBe(
      DEFAULT_TEMPLATE_URL
    );
    expect(runGit(targetDir, ['remote', 'get-url', '--push', 'upstream'])).toBe(
      'DISABLED'
    );
    expect(runGit(targetDir, ['config', '--get', 'remote.pushDefault'])).toBe(
      'origin'
    );
    expect(runGit(targetDir, ['config', '--get', 'push.default'])).toBe(
      'current'
    );
    expect(
      runGit(targetDir, ['config', '--get', 'branch.main.pushRemote'])
    ).toBe('origin');
    expect(runGit(targetDir, ['status', '--short', '.gitignore'])).toBe(
      'M  .gitignore'
    );
  });

  it('keeps an existing origin while adding the template upstream', () => {
    const targetDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tanstarter-git-')
    );
    runGit(targetDir, ['init', '-b', 'main']);
    runGit(targetDir, [
      'remote',
      'add',
      'origin',
      'https://github.com/example/demo-app.git',
    ]);

    initializeGit(targetDir);
    initializeGit(targetDir);

    expect(runGit(targetDir, ['remote', 'get-url', 'origin'])).toBe(
      'https://github.com/example/demo-app.git'
    );
    expect(runGit(targetDir, ['remote', 'get-url', 'upstream'])).toBe(
      DEFAULT_TEMPLATE_URL
    );
  });

  it('pushes the current branch to origin instead of upstream by default', () => {
    const rootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tanstarter-push-target-')
    );
    const seedDir = path.join(rootDir, 'seed');
    const templateDir = path.join(rootDir, 'template.git');
    const productDir = path.join(rootDir, 'product.git');
    const targetDir = path.join(rootDir, 'project');

    fs.mkdirSync(seedDir);
    runGit(seedDir, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(seedDir, 'README.md'), '# Template\n', 'utf8');
    fs.writeFileSync(path.join(seedDir, '.gitignore'), 'node_modules\n', 'utf8');
    runGit(seedDir, ['add', '.']);
    runGit(seedDir, [
      '-c',
      'user.name=TanStarter Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'template base',
    ]);
    const templateHead = runGit(seedDir, ['rev-parse', 'HEAD']);

    runGit(rootDir, ['init', '--bare', templateDir]);
    runGit(seedDir, ['remote', 'add', 'template', templateDir]);
    runGit(seedDir, ['push', 'template', 'main']);
    runGit(rootDir, [
      '--git-dir',
      templateDir,
      'symbolic-ref',
      'HEAD',
      'refs/heads/main',
    ]);
    runGit(rootDir, ['init', '--bare', productDir]);
    runGit(rootDir, ['clone', '--origin', 'upstream', templateDir, targetDir]);

    initializeGit(targetDir);
    runGit(targetDir, ['remote', 'set-url', 'upstream', templateDir]);
    runGit(targetDir, ['remote', 'add', 'origin', productDir]);
    fs.writeFileSync(path.join(targetDir, 'product.txt'), 'MkExt\n', 'utf8');
    runGit(targetDir, ['add', '.']);
    runGit(targetDir, [
      '-c',
      'user.name=TanStarter Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'product change',
    ]);
    const productHead = runGit(targetDir, ['rev-parse', 'HEAD']);

    runGit(targetDir, ['push']);

    expect(runGit(rootDir, ['--git-dir', productDir, 'rev-parse', 'main'])).toBe(
      productHead
    );
    expect(
      runGit(rootDir, ['--git-dir', templateDir, 'rev-parse', 'main'])
    ).toBe(templateHead);
  });
});

describe('setup state', () => {
  it('never writes the Waffo private key to the state file', () => {
    const config = {
      ...createTestConfig({
        paymentProvider: 'waffo',
        waffoMerchantId: 'MER_test',
        waffoPrivateKey: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----',
      }),
      projectName: 'demo-app',
    } as RuntimeConfig;

    writeState(config.targetDir, {
      completedSteps: [],
      config,
      updatedAt: new Date().toISOString(),
    });

    const raw = fs.readFileSync(
      path.join(config.targetDir, '.tanstarter', 'state.json'),
      'utf8'
    );
    expect(raw).not.toContain('SECRET');
    expect(raw).not.toContain('api-token');
    expect(raw).toContain('"cloudflareApiToken": ""');
    expect(raw).toContain('"waffoPrivateKey": ""');
    expect(JSON.parse(raw).config.waffoMerchantId).toBe('MER_test');
  });

  it('warns instead of silently starting over when --resume finds no state', () => {
    const config = createTestConfig({ preset: 'free' });
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-test-'));
    const logs: string[] = [];
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '));
      });

    try {
      const state = readState(emptyDir, config);
      expect(state.completedSteps).toEqual([]);
    } finally {
      logSpy.mockRestore();
    }

    const output = logs.join('\n');
    expect(output).toContain('No setup state found at');
    expect(output).toContain(path.join(emptyDir, '.tanstarter', 'state.json'));
    expect(output).toContain('starts a brand-new project');
    // The tier it would silently fall back to is the whole point of the warning.
    expect(output).toContain('preset: free');
  });

  it('stays quiet when --resume finds the state file', () => {
    const config = createTestConfig({ preset: 'free' });
    writeState(config.targetDir, {
      completedSteps: ['clone-template'],
      config,
      updatedAt: new Date().toISOString(),
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const state = readState(config.targetDir, config);
      expect(state.completedSteps).toEqual(['clone-template']);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('persists the preset so --resume and delete see the same tier', () => {
    const config = createTestConfig({ preset: 'free' });

    writeState(config.targetDir, {
      completedSteps: [],
      config,
      updatedAt: new Date().toISOString(),
    });

    expect(readExistingState(config.targetDir).config.preset).toBe('free');
  });
});

describe('install planning', () => {
  const has = (...commands: string[]) => (command: string) =>
    commands.includes(command);

  it('uses corepack for pnpm when available', () => {
    expect(getInstallPlan('pnpm', 'darwin', has('corepack'))).toEqual([
      { command: 'corepack', args: ['enable'] },
      { command: 'corepack', args: ['prepare', 'pnpm@latest', '--activate'] },
    ]);
  });

  it('uses Homebrew for GitHub CLI on macOS', () => {
    expect(getInstallPlan('gh', 'darwin', has('brew'))).toEqual([
      { command: 'brew', args: ['install', 'gh'] },
    ]);
  });

  it('uses sudo apt-get for git on non-root Linux', () => {
    expect(getInstallPlan('git', 'linux', has('apt-get'), false)).toEqual([
      { command: 'sudo', args: ['apt-get', 'update'] },
      { command: 'sudo', args: ['apt-get', 'install', '-y', 'git'] },
    ]);
  });
});

describe('setup prompts', () => {
  it('defaults the GitHub repo to the current GitHub login and project name', () => {
    expect(formatDefaultGithubRepo('myapp4', 'myapp4', 'open-fox')).toBe(
      'open-fox/myapp4'
    );
    expect(
      formatDefaultGithubRepo('myapp4', 'mkfasthq/custom-repo', 'open-fox')
    ).toBe('mkfasthq/custom-repo');
  });
});

describe('entrypoint detection', () => {
  it('treats npm bin symlinks as the CLI entrypoint', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-bin-'));
    const realEntrypoint = path.join(tempDir, 'index.js');
    const symlinkEntrypoint = path.join(tempDir, 'tanstarter');

    fs.writeFileSync(realEntrypoint, '#!/usr/bin/env node\n', 'utf8');
    fs.symlinkSync(realEntrypoint, symlinkEntrypoint);

    expect(
      isCliEntrypoint(symlinkEntrypoint, pathToFileURL(realEntrypoint).href)
    ).toBe(true);
  });
});

describe('createConfig with Waffo payment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires Waffo credentials when payment is waffo', () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'api-token');
    vi.stubEnv('WAFFO_MERCHANT_ID', '');
    vi.stubEnv('WAFFO_PRIVATE_KEY', '');

    expect(() =>
      createConfig(parseArgs(['create', 'demo-app', '--payment', 'waffo']))
    ).toThrow('WAFFO_MERCHANT_ID is required in your environment');
  });

  it('keeps Waffo credentials optional without the waffo payment option', () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'api-token');
    vi.stubEnv('WAFFO_MERCHANT_ID', '');
    vi.stubEnv('WAFFO_PRIVATE_KEY', '');

    const config = createConfig(parseArgs(['create', 'demo-app']));
    expect(config.paymentProvider).toBe('none');
    expect(config.waffoMerchantId).toBe('');
  });

  it('reads Waffo credentials from the environment when provided', () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'api-token');
    vi.stubEnv('WAFFO_MERCHANT_ID', 'MER_test');
    vi.stubEnv('WAFFO_PRIVATE_KEY', testPrivateKeyPem);

    const config = createConfig(
      parseArgs(['create', 'demo-app', '--payment', 'waffo'])
    );
    expect(config.paymentProvider).toBe('waffo');
    expect(config.waffoMerchantId).toBe('MER_test');
    expect(config.waffoPrivateKey).toBe(testPrivateKeyPem);
    expect(config.waffoStoreName).toBe('demo-app');
    expect(config.waffoProductIds).toEqual({
      proMonthly: '',
      proYearly: '',
      lifetime: '',
    });
  });

  it('accepts the Waffo private key value without enforcing a local format', () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'api-token');
    vi.stubEnv('WAFFO_MERCHANT_ID', 'MER_test');
    vi.stubEnv('WAFFO_PRIVATE_KEY', 'waffo-private-key-value');

    const config = createConfig(
      parseArgs(['create', 'demo-app', '--payment', 'waffo'])
    );

    expect(config.waffoPrivateKey).toBe('waffo-private-key-value');
  });
});

describe('setup prompts for presets', () => {
  async function runConfigureSetup(
    options: Partial<CliOptions>,
    config: RuntimeConfig,
    answers: string[]
  ): Promise<{ config: RuntimeConfig; output: string }> {
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', {
      value: stdin,
      configurable: true,
    });

    const chunks: string[] = [];
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        chunks.push(args.join(' '));
      });
    // Answer one prompt at a time. Readline drops line events that arrive
    // while no question is pending, so the whole script cannot be written
    // up front.
    const pending = [...answers];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        const text = String(chunk);
        chunks.push(text);
        if (text.trimEnd().endsWith(':') && pending.length > 0) {
          setImmediate(() => stdin.write(`${pending.shift()}\n`));
        }
        return true;
      }) as typeof process.stdout.write);

    try {
      const next = await configureSetup(
        {
          command: 'create',
          projectName: config.projectName,
          targetDir: config.targetDir,
          // Both are supplied so the flow never shells out to GitHub CLI.
          domain: 'demo.example.com',
          githubRepo: 'demo-owner/demo-app',
          resume: false,
          ...options,
        } as CliOptions,
        config
      );
      return { config: next, output: chunks.join('\n') };
    } finally {
      logSpy.mockRestore();
      writeSpy.mockRestore();
      Object.defineProperty(process, 'stdin', originalStdin);
      stdin.end();
    }
  }

  it('asks for the preset and skips the payment question on free', async () => {
    const { config, output } = await runConfigureSetup(
      {},
      createTestConfig({ domain: 'demo.example.com' }),
      ['free', '', '', '', '']
    );

    expect(config.preset).toBe('free');
    expect(config.paymentProvider).toBe('none');
    expect(output).toContain('Preset (free/account/full, default: full):');
    expect(output).not.toContain('Payment method');
  });

  it('defaults to full on an empty answer and still asks for payment', async () => {
    const { config, output } = await runConfigureSetup(
      {},
      createTestConfig({ domain: 'demo.example.com' }),
      ['', 'none', '', '', '', '']
    );

    expect(config.preset).toBe('full');
    expect(output).toContain('Payment method');
  });

  it('re-asks after an invalid preset answer', async () => {
    const { config, output } = await runConfigureSetup(
      {},
      createTestConfig({ domain: 'demo.example.com' }),
      ['pro', 'account', 'none', '', '', '', '']
    );

    expect(config.preset).toBe('account');
    expect(output).toContain('Preset must be one of: free, account, full.');
  });

  it('rejects a free answer that contradicts an explicit --payment', async () => {
    await expect(
      runConfigureSetup(
        { payment: 'waffo' },
        createTestConfig({
          domain: 'demo.example.com',
          paymentProvider: 'waffo',
        }),
        ['free', '', '', '', '']
      )
    ).rejects.toThrow('The free preset does not support payment');
  });
});

describe('createConfig with presets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubCloudflareEnv(): void {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'api-token');
  }

  it('defaults to the full preset so existing commands are unchanged', () => {
    stubCloudflareEnv();

    expect(createConfig(parseArgs(['create', 'demo-app'])).preset).toBe('full');
  });

  it('carries the selected preset into the runtime config', () => {
    stubCloudflareEnv();

    expect(
      createConfig(parseArgs(['create', 'demo-app', '--preset', 'free'])).preset
    ).toBe('free');
  });

  it('rejects payment on the free preset instead of ignoring it', () => {
    stubCloudflareEnv();
    vi.stubEnv('WAFFO_MERCHANT_ID', 'MER_test');
    vi.stubEnv('WAFFO_PRIVATE_KEY', 'key');

    expect(() =>
      createConfig(
        parseArgs(['create', 'demo-app', '--preset', 'free', '--payment', 'waffo'])
      )
    ).toThrow('The free preset does not support payment');
  });

  it('allows the account preset without a payment provider', () => {
    stubCloudflareEnv();

    const config = createConfig(
      parseArgs(['create', 'demo-app', '--preset', 'account'])
    );
    expect(config.preset).toBe('account');
    expect(config.paymentProvider).toBe('none');
  });
});

describe('preset file writing', () => {
  const PRESET_SOURCE = [
    "export type PresetName = 'free' | 'account' | 'full';",
    '',
    '/** The active tier. This is the one line to change after cloning. */',
    "export const ACTIVE_PRESET: PresetName = 'full';",
    '',
    'export const preset: PresetFlags = PRESETS[ACTIVE_PRESET];',
    '',
  ].join('\n');

  function seedPresetFile(targetDir: string, source: string): string {
    const presetPath = path.join(targetDir, 'src', 'config', 'preset.ts');
    fs.mkdirSync(path.dirname(presetPath), { recursive: true });
    fs.writeFileSync(presetPath, source, 'utf8');
    return presetPath;
  }

  it('replaces only the ACTIVE_PRESET literal and leaves the rest intact', () => {
    const config = createTestConfig({ preset: 'free' });
    const presetPath = seedPresetFile(config.targetDir, PRESET_SOURCE);

    writePresetConfig(config);

    const written = fs.readFileSync(presetPath, 'utf8');
    expect(written).toContain("export const ACTIVE_PRESET: PresetName = 'free';");
    expect(written).toBe(
      PRESET_SOURCE.replace(
        "ACTIVE_PRESET: PresetName = 'full';",
        "ACTIVE_PRESET: PresetName = 'free';"
      )
    );
  });

  it('is idempotent, so --resume rewrites the same value', () => {
    const config = createTestConfig({ preset: 'account' });
    const presetPath = seedPresetFile(config.targetDir, PRESET_SOURCE);

    writePresetConfig(config);
    writePresetConfig(config);

    expect(fs.readFileSync(presetPath, 'utf8')).toContain(
      "export const ACTIVE_PRESET: PresetName = 'account';"
    );
  });

  it('fails loudly when the template predates the preset layer', () => {
    const config = createTestConfig({ preset: 'free' });

    expect(() => writePresetConfig(config)).toThrow(
      'The cloned template predates the preset layer'
    );
  });

  it('fails loudly when the declaration no longer matches', () => {
    const config = createTestConfig({ preset: 'free' });
    seedPresetFile(
      config.targetDir,
      'export const ACTIVE_PRESET = "full" as PresetName;\n'
    );

    expect(() => writePresetConfig(config)).toThrow(
      'Could not find the ACTIVE_PRESET declaration'
    );
  });
});

describe('Waffo helpers', () => {
  it('derives a bounded store name and fixed template products', () => {
    expect(waffoStoreNameForProject('a'.repeat(63))).toHaveLength(48);
    expect(WAFFO_TEMPLATE_PRODUCTS).toMatchObject([
      { slot: 'proMonthly', price: '9.90', type: 'subscription' },
      { slot: 'proYearly', price: '99.00', type: 'subscription' },
      { slot: 'lifetime', price: '199.00', type: 'onetime' },
    ]);
  });

  it('signs requests with RSA-SHA256 per the API docs', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const config = createTestConfig({
      paymentProvider: 'waffo',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string,
    });

    const { timestamp, signature, bodyJson } = signWaffoRequest(
      config,
      'POST',
      '/v1/actions/store/create-store',
      { name: 'demo-app' }
    );
    const { canonicalRequest } = buildWaffoCanonicalRequest(
      'POST',
      '/v1/actions/store/create-store',
      timestamp,
      { name: 'demo-app' }
    );

    expect(bodyJson).toBe(JSON.stringify({ name: 'demo-app' }));
    expect(
      crypto.verify(
        'sha256',
        Buffer.from(canonicalRequest, 'utf8'),
        publicKey,
        Buffer.from(signature, 'base64')
      )
    ).toBe(true);
  });

  it('normalizes PEM keys with real newlines for env files', () => {
    expect(normalizePemForEnv('key\nvalue\n')).toBe('key\\nvalue\\n');
    expect(normalizePemForEnv('key\\nvalue')).toBe('key\\nvalue');
  });

  it('formats and validates product prices', () => {
    expect(formatWaffoPrice('9.9')).toBe('9.90');
    expect(formatWaffoPrice('29')).toBe('29.00');
    expect(() => formatWaffoPrice('0')).toThrow(
      'Price must be a positive number'
    );
    expect(() => formatWaffoPrice('abc')).toThrow(
      'Price must be a positive number'
    );
    expect(() => formatWaffoPrice('9.999')).toThrow(
      'Price must be a positive number'
    );
  });

  it('builds webhook URLs from a public HTTPS base URL', () => {
    expect(buildWaffoWebhookUrl('https://app.example.com/')).toBe(
      'https://app.example.com/api/webhooks/waffo'
    );
    expect(() => buildWaffoWebhookUrl('app.example.com')).toThrow(
      'must use HTTPS'
    );
  });

  it('normalizes escaped PEM values before signing', () => {
    const escaped = normalizePemForEnv(testPrivateKeyPem);
    expect(normalizePemForCrypto(escaped)).toBe(testPrivateKeyPem.trim());
  });

  it('normalizes raw Base64 PKCS#8 private keys before signing', () => {
    const rawBase64 = testPrivateKey
      .export({ type: 'pkcs8', format: 'der' })
      .toString('base64');
    const normalized = normalizePemForCrypto(rawBase64);

    expect(normalized).toContain('-----BEGIN PRIVATE KEY-----');
    expect(() => crypto.createPrivateKey(normalized)).not.toThrow();
  });

  it('signs requests with a raw Base64 PKCS#8 private key', () => {
    const rawBase64 = testPrivateKey
      .export({ type: 'pkcs8', format: 'der' })
      .toString('base64');
    const config = createTestConfig({
      paymentProvider: 'waffo',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: rawBase64,
    });
    const { timestamp, signature, bodyJson } = signWaffoRequest(
      config,
      'POST',
      '/v1/actions/store/create-store',
      { name: 'demo-app' }
    );
    const { canonicalRequest } = buildWaffoCanonicalRequest(
      'POST',
      '/v1/actions/store/create-store',
      timestamp,
      { name: 'demo-app' }
    );

    expect(bodyJson).toBe(JSON.stringify({ name: 'demo-app' }));
    expect(
      crypto.verify(
        'sha256',
        Buffer.from(canonicalRequest, 'utf8'),
        crypto.createPublicKey(testPrivateKey),
        Buffer.from(signature, 'base64')
      )
    ).toBe(true);
  });
});

describe('Waffo API resource flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the store, all template products, and the webhook', async () => {
    const responses = [
      { data: { store: { id: 'STO_test' } } },
      { data: { product: { id: 'PROD_monthly' } } },
      { data: { product: { id: 'PROD_yearly' } } },
      { data: { product: { id: 'PROD_lifetime' } } },
      { data: { webhook: { id: 'WEBHOOK_test' } } },
    ];
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ path: url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );

    const config = createTestConfig({
      paymentProvider: 'waffo',
      domain: 'app.example.com',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: testPrivateKeyPem,
      waffoStoreName: 'demo-app',
    });

    const storeId = await createWaffoStore(config, config.waffoStoreName);
    const productIds = {
      proMonthly: '',
      proYearly: '',
      lifetime: '',
    };
    for (const product of WAFFO_TEMPLATE_PRODUCTS) {
      productIds[product.slot] = await createWaffoProduct(
        { ...config, waffoStoreId: storeId },
        product
      );
    }
    const webhookId = await addWaffoWebhook(
      { ...config, waffoStoreId: storeId },
      storeId,
      'https://app.example.com'
    );

    expect(storeId).toBe('STO_test');
    expect(productIds).toEqual({
      proMonthly: 'PROD_monthly',
      proYearly: 'PROD_yearly',
      lifetime: 'PROD_lifetime',
    });
    expect(webhookId).toBe('WEBHOOK_test');
    expect(calls.map((call) => call.path)).toEqual([
      'https://api.waffo.ai/v1/actions/store/create-store',
      'https://api.waffo.ai/v1/actions/subscription-product/create-product',
      'https://api.waffo.ai/v1/actions/subscription-product/create-product',
      'https://api.waffo.ai/v1/actions/onetime-product/create-product',
      'https://api.waffo.ai/v1/actions/store/add-webhook',
    ]);
    expect(calls[0].body).toEqual({ name: 'demo-app' });
    expect(calls[1].body).toMatchObject({
      storeId: 'STO_test',
      name: 'Pro Monthly',
      billingPeriod: 'monthly',
      prices: {
        USD: { amount: '9.90', taxIncluded: false, taxCategory: 'saas' },
      },
    });
    expect(calls[2].body).toMatchObject({
      storeId: 'STO_test',
      name: 'Pro Yearly',
      billingPeriod: 'yearly',
      prices: {
        USD: { amount: '99.00', taxIncluded: false, taxCategory: 'saas' },
      },
    });
    expect(calls[3].body).toMatchObject({
      storeId: 'STO_test',
      name: 'Lifetime',
      prices: {
        USD: { amount: '199.00', taxIncluded: false, taxCategory: 'saas' },
      },
    });
    expect(calls[4].body).toMatchObject({
      storeId: 'STO_test',
      channel: 'http',
      url: 'https://app.example.com/api/webhooks/waffo',
      testMode: true,
      events: WAFFO_WEBHOOK_EVENTS,
    });
  });

  it('creates subscription products with the chosen billing period', async () => {
    const responses = [{ data: { product: { id: 'PROD_yearly' } } }];
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ path: url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );

    const config = createTestConfig({
      paymentProvider: 'waffo',
      waffoStoreId: 'STO_test',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: testPrivateKeyPem,
    });

    await createWaffoProduct(config, {
      slot: 'proYearly',
      name: 'Pro Yearly',
      price: '99',
      type: 'subscription',
      billingPeriod: 'yearly',
    });

    expect(calls[0].path).toBe(
      'https://api.waffo.ai/v1/actions/subscription-product/create-product'
    );
    expect(calls[0].body).toMatchObject({
      name: 'Pro Yearly',
      billingPeriod: 'yearly',
    });
    expect(calls[0].body).toMatchObject({ storeId: 'STO_test' });
  });

  it('always uses testMode for Waffo webhooks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: { webhook: { id: 'WEBHOOK_test' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    const config = createTestConfig({
      paymentProvider: 'waffo',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: testPrivateKeyPem,
    });

    await addWaffoWebhook(config, 'STO_test', 'https://app.example.com');
    const request = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body).testMode).toBe(true);
  });

  it('fails on API errors instead of continuing with a partial payment setup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ errors: [{ message: 'Store limit reached' }] }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      )
    );

    const config = createTestConfig({
      paymentProvider: 'waffo',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: testPrivateKeyPem,
    });

    await expect(createWaffoStore(config, 'My Store')).rejects.toThrow(
      'Store limit reached'
    );
  });

  it('verifies a deployed webhook endpoint before registration', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/webhooks/waffo')) {
        return new Response(JSON.stringify({ error: 'Missing payload' }), {
          status: 400,
        });
      }
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyWaffoWebhookEndpoint('https://app.example.com')).resolves
      .toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/webhooks/waffo',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('Waffo env file writing', () => {
  it('writes Waffo payment variables into both env files', () => {
    const config = createTestConfig({
      paymentProvider: 'waffo',
      domain: 'app.example.com',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----',
      waffoStoreId: 'STO_test',
      waffoProductIds: {
        proMonthly: 'PROD_monthly',
        proYearly: 'PROD_test',
        lifetime: 'PROD_lifetime',
      },
    });
    fs.writeFileSync(path.join(config.targetDir, '.env.example'), '', 'utf8');

    ensureEnvFiles(config);

    const production = fs.readFileSync(
      path.join(config.targetDir, '.env.production'),
      'utf8'
    );
    expect(production).toContain("VITE_PAYMENT_PROVIDER='waffo'");
    expect(production).toContain("WAFFO_DEBUG='true'");
    expect(production).toContain("WAFFO_MERCHANT_ID='MER_test'");
    expect(production).toContain(
      "WAFFO_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\\nMIIE...\\n-----END PRIVATE KEY-----'"
    );
    expect(production).toContain("WAFFO_STORE_ID='STO_test'");
    expect(production).toContain("VITE_WAFFO_PRODUCT_PRO_YEARLY='PROD_test'");
    expect(production).toContain("VITE_WAFFO_PRODUCT_PRO_MONTHLY='PROD_monthly'");
    expect(production).toContain("VITE_WAFFO_PRODUCT_LIFETIME='PROD_lifetime'");

    const local = fs.readFileSync(path.join(config.targetDir, '.env'), 'utf8');
    expect(local).toContain("VITE_PAYMENT_PROVIDER='waffo'");
    expect(local).toContain("WAFFO_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\\nMIIE...\\n-----END PRIVATE KEY-----'");
  });

  it('always enables test webhook verification', () => {
    const config = createTestConfig({
      paymentProvider: 'waffo',
      waffoMerchantId: 'MER_test',
      waffoPrivateKey: testPrivateKeyPem,
      waffoStoreId: 'STO_test',
    });
    fs.writeFileSync(path.join(config.targetDir, '.env.example'), '', 'utf8');

    ensureEnvFiles(config);

    const production = fs.readFileSync(
      path.join(config.targetDir, '.env.production'),
      'utf8'
    );
    expect(production).toContain("WAFFO_DEBUG='true'");
  });

  it('disables stale payment variables when payment is disabled', () => {
    const config = createTestConfig({ paymentProvider: 'none' });
    fs.writeFileSync(
      path.join(config.targetDir, '.env.example'),
      "VITE_PAYMENT_PROVIDER='waffo'\nWAFFO_MERCHANT_ID='stale-merchant'\n",
      'utf8'
    );

    ensureEnvFiles(config);

    const production = fs.readFileSync(
      path.join(config.targetDir, '.env.production'),
      'utf8'
    );
    expect(production).toContain("VITE_PAYMENT_PROVIDER=''");
    expect(production).toContain("WAFFO_MERCHANT_ID=''");
  });
});

describe('deployment URL resolution', () => {
  it('prefers the custom domain and falls back to workers.dev', () => {
    expect(
      getPublicBaseUrl(
        createTestConfig({
          domain: 'app.example.com',
          deploymentUrl: 'https://demo-app.workers.dev',
        })
      )
    ).toBe('https://app.example.com');
    expect(
      getPublicBaseUrl(
        createTestConfig({ deploymentUrl: 'https://demo-app.workers.dev/' })
      )
    ).toBe('https://demo-app.workers.dev');
  });

  it('fails public deployment verification when the URL is not serving', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 }))
    );
    await expect(
      verifyPublicDeployment(
        createTestConfig({ domain: 'app.example.com' }),
        { retryDelaysMs: [] }
      )
    ).rejects.toThrow('site is not reachable');
    vi.unstubAllGlobals();
  });

  it('waits for a transient DNS failure before accepting the public URL', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const delays: number[] = [];
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      verifyPublicDeployment(createTestConfig({ domain: 'app.example.com' }), {
        retryDelaysMs: [2_000],
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2_000]);
    vi.unstubAllGlobals();
  });
});
