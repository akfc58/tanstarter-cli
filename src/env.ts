import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { RuntimeConfig } from './types.js';
import { normalizePemForEnv } from './waffo.js';

const WAFFO_ENV_KEYS = [
  'WAFFO_DEBUG',
  'WAFFO_MERCHANT_ID',
  'WAFFO_PRIVATE_KEY',
  'WAFFO_STORE_ID',
  'VITE_WAFFO_PRODUCT_PRO_MONTHLY',
  'VITE_WAFFO_PRODUCT_PRO_YEARLY',
  'VITE_WAFFO_PRODUCT_LIFETIME',
] as const;

export function ensureEnvFiles(config: RuntimeConfig): void {
  const examplePath = resolveEnvExamplePath(config.targetDir);
  const processEnvValues = getProcessEnvValuesFromExample(examplePath);
  delete processEnvValues.VITE_PAYMENT_PROVIDER;
  for (const key of WAFFO_ENV_KEYS) {
    delete processEnvValues[key];
  }
  const sharedValues: Record<string, string> = {
    CLOUDFLARE_ACCOUNT_ID: config.cloudflareAccountId,
    CLOUDFLARE_API_TOKEN: config.cloudflareApiToken,
    CLOUDFLARE_DATABASE_ID: config.d1DatabaseId,
    VITE_PAYMENT_PROVIDER:
      config.paymentProvider === 'waffo' ? 'waffo' : '',
  };
  if (config.paymentProvider === 'waffo') {
    Object.assign(sharedValues, waffoEnvValues(config));
  } else {
    for (const key of WAFFO_ENV_KEYS) {
      sharedValues[key] = '';
    }
  }

  const declaredKeys = Object.keys(parseEnvFile(examplePath));

  for (const envFile of ['.env', '.env.production']) {
    const envPath = path.join(config.targetDir, envFile);
    ensureEnvFile(envPath, examplePath);
    const existing = parseEnvFile(envPath);
    const baseUrl =
      envFile === '.env'
        ? 'http://localhost:3000'
        : getProductionBaseUrl(config);
    const betterAuthSecret =
      existing.BETTER_AUTH_SECRET ||
      process.env.BETTER_AUTH_SECRET ||
      crypto.randomBytes(32).toString('base64url');

    const values = {
      ...processEnvValues,
      ...sharedValues,
      VITE_BASE_URL: baseUrl,
      BETTER_AUTH_SECRET: betterAuthSecret,
    };
    updateEnvFile(envPath, values);
    warnMissingKeys(envFile, declaredKeys, { ...existing, ...values });
  }
}

/**
 * An env file kept from an earlier run is never re-seeded, so one written by a
 * CLI that failed to locate the manifest stays short of variables forever.
 * Say so instead of leaving the gap to surface at build or secret-sync time.
 */
function warnMissingKeys(
  envFile: string,
  declaredKeys: string[],
  present: Record<string, string>
): void {
  const missing = declaredKeys.filter((key) => !(key in present));
  if (missing.length === 0) return;

  console.warn(
    [
      `Warning: ${envFile} is missing ${missing.length} variable(s) declared by the template:`,
      `  ${missing.join(', ')}`,
      '  Copy them over from the template manifest before deploying.',
    ].join('\n')
  );
}

function waffoEnvValues(config: RuntimeConfig): Record<string, string> {
  const productIds = config.waffoProductIds;
  return {
    VITE_PAYMENT_PROVIDER: 'waffo',
    // The deployed Worker intentionally stays in Waffo test mode. WAFFO_DEBUG
    // makes it verify and accept test webhooks.
    WAFFO_DEBUG: 'true',
    WAFFO_MERCHANT_ID: config.waffoMerchantId,
    WAFFO_PRIVATE_KEY: normalizePemForEnv(config.waffoPrivateKey),
    WAFFO_STORE_ID: config.waffoStoreId,
    VITE_WAFFO_PRODUCT_PRO_MONTHLY: productIds.proMonthly,
    VITE_WAFFO_PRODUCT_PRO_YEARLY: productIds.proYearly,
    VITE_WAFFO_PRODUCT_LIFETIME: productIds.lifetime,
  };
}

function getProductionBaseUrl(config: RuntimeConfig): string {
  if (config.domain) return `https://${config.domain}`;
  return config.deploymentUrl || 'http://localhost:3000';
}

/**
 * The template ships its variable manifest as `env.example` — no leading dot,
 * so the template's own `.env*` gitignore rules keep their hands off it. The
 * dotted spelling stays accepted for older templates.
 */
const ENV_EXAMPLE_NAMES = ['env.example', '.env.example'] as const;

/**
 * A missing manifest must fail loudly: silently seeding empty env files ships a
 * project missing every variable the template declares, and that only surfaces
 * much later, at build or secret-sync time.
 */
function resolveEnvExamplePath(targetDir: string): string {
  for (const name of ENV_EXAMPLE_NAMES) {
    const candidate = path.join(targetDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    [
      `Could not find ${ENV_EXAMPLE_NAMES.join(' or ')} in the generated project.`,
      'The cloned template carries no environment variable manifest, so .env and',
      '.env.production cannot be seeded. Update the template, or use a CLI version',
      'matching it.',
    ].join('\n')
  );
}

function ensureEnvFile(filePath: string, examplePath: string): void {
  if (fs.existsSync(filePath)) return;

  fs.writeFileSync(filePath, fs.readFileSync(examplePath, 'utf8'), 'utf8');
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  const env: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) continue;
    env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }

  return env;
}

function getProcessEnvValuesFromExample(
  examplePath: string
): Record<string, string> {
  const values: Record<string, string> = {};
  const example = parseEnvFile(examplePath);

  for (const key of Object.keys(example)) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      values[key] = value;
    }
  }

  return values;
}

function updateEnvFile(filePath: string, values: Record<string, string>): void {
  const seen = new Set<string>();
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (!match) return line;

    const key = match[1];
    if (!key || !(key in values)) return line;

    seen.add(key);
    return `${key}=${formatEnvValue(values[key] ?? '')}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  fs.writeFileSync(
    filePath,
    `${lines.join('\n').replace(/\n+$/, '')}\n`,
    'utf8'
  );
}

export function formatEnvValue(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}
