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

/** Counts every occurrence, regardless of whether the pattern carries `g`. */
function countMatches(content: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`;
  return content.match(new RegExp(pattern.source, flags))?.length ?? 0;
}

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
    // Exactly one, not at least one. None of these patterns carry `g`, so
    // `String.replace` rewrites only the first match — and `assertGeneratedFields`
    // below only reads the first array entry. A second occurrence (Wrangler
    // supports `env.<name>` blocks that redeclare bindings) would therefore be
    // left pointing at the template author's resources, silently and with every
    // check still green. Refuse instead, and say the template moved.
    const hits = countMatches(content, edit.pattern);
    if (hits !== 1) {
      throw new Error(
        [
          hits === 0
            ? `Could not find ${edit.label} in wrangler.jsonc.`
            : `Found ${hits} matches for ${edit.label} in wrangler.jsonc, expected exactly one.`,
          DRIFT_HINT,
        ].join('\n')
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

  // The structural half of the same guard as the match count above: the field
  // checks below only ever read `[0]`, so a second binding of any kind would
  // keep the template author's id and still pass.
  const bindings: Array<[string, number]> = [
    ['d1_databases', parsed.d1_databases?.length ?? 0],
    ['r2_buckets', parsed.r2_buckets?.length ?? 0],
    ['kv_namespaces', parsed.kv_namespaces?.length ?? 0],
  ];
  const wrongCount = bindings.filter(([, count]) => count !== 1);
  if (wrongCount.length > 0) {
    throw new Error(
      [
        `wrangler.jsonc must declare exactly one of each binding; found ${wrongCount
          .map(([label, count]) => `${count} ${label}`)
          .join(', ')}.`,
        DRIFT_HINT,
      ].join('\n')
    );
  }
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
