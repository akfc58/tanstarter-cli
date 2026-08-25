import type { RuntimeConfig } from './types.js';
import { getPublicBaseUrl } from './deployment.js';
import {
  buildWaffoWebhookUrl,
  WAFFO_TEMPLATE_PRODUCTS,
} from './waffo.js';

const BOX_WIDTH = 96;

export function printWelcomeBanner(): void {
  printBox([
    '████████╗ █████╗ ███╗   ██╗███████╗████████╗ █████╗ ██████╗ ████████╗███████╗██████╗',
    '╚══██╔══╝██╔══██╗████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝██╔════╝██╔══██╗',
    '   ██║   ███████║██╔██╗ ██║███████╗   ██║   ███████║██████╔╝   ██║   █████╗  ██████╔╝',
    '   ██║   ██╔══██║██║╚██╗██║╚════██║   ██║   ██╔══██║██╔══██╗   ██║   ██╔══╝  ██╔══██╗',
    '   ██║   ██║  ██║██║ ╚████║███████║   ██║   ██║  ██║██║  ██║   ██║   ███████╗██║  ██║',
    '   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝',
    '',
    'Website: https://tanstarter.dev',
    'Docs:    https://docs.tanstarter.dev',
    'Video:   https://docs.tanstarter.dev/video',
  ]);
}

export function printStep(
  index: number,
  total: number | undefined,
  title: string
): void {
  printBox([`🚀 ${total ? `Step ${index}/${total}` : `Step ${index}`}: ${title}`]);
}

export function printCompletedStep(title: string): void {
  console.log(`✅ ${title} completed`);
}

export function printFinalSummary(config: RuntimeConfig): void {
  const productionUrl =
    (config.domain ? `https://${config.domain}` : config.deploymentUrl) ||
    '(check Wrangler deploy output)';
  const githubUrl = config.githubRepoUrl || githubRepoToUrl(config.githubRepo);

  printBox([
    '🎉 TanStarter project is ready',
    '',
    `Project: ${config.projectName}`,
    `Preset: ${config.preset}`,
    `Directory: ${config.targetDir}`,
    `Website: ${productionUrl}`,
    `GitHub: ${githubUrl}`,
    `Delete: npx tanstarter-cli@latest delete ${config.projectName}`,
    ...(config.preset === 'free'
      ? [
          '',
          'The free preset still provisions D1, R2, and KV so the Worker boots.',
          'They sit idle inside the free tiers; nothing is billed until you use them.',
        ]
      : []),
  ]);
  if (config.paymentProvider === 'waffo') {
    const publicBaseUrl = getPublicBaseUrl(config);
    const productIds = config.waffoProductIds;
    printBox([
      '💳 Waffo payment (test)',
      '⚠ Test transactions only.',
      '',
      `Store: ${config.waffoStoreId || '(not created)'}`,
      ...WAFFO_TEMPLATE_PRODUCTS.map(
        (product) =>
          `${product.name}: ${productIds[product.slot] || '(not created)'}`
      ),
      `Webhook: ${
        publicBaseUrl
          ? buildWaffoWebhookUrl(publicBaseUrl)
          : '(not registered)'
      }`,
    ]);
  }
}

function printBox(lines: string[]): void {
  const border = '═'.repeat(BOX_WIDTH - 2);
  console.log(`\n╔${border}╗`);
  for (const line of lines) {
    console.log(`║ ${fitLine(line)} ║`);
  }
  console.log(`╚${border}╝`);
}

function fitLine(line: string): string {
  const maxLength = BOX_WIDTH - 4;
  if (line.length <= maxLength) return line.padEnd(maxLength, ' ');
  return `${line.slice(0, maxLength - 1)}…`;
}

function githubRepoToUrl(repo: string): string {
  return repo.includes('/') ? `https://github.com/${repo}` : repo;
}

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
