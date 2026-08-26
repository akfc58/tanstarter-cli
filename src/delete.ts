import { createInterface } from 'node:readline/promises';

import { deleteD1, deleteKV, deleteR2, deleteWorker } from './cloudflare.js';
import { deleteGithubRepo } from './git.js';
import { formatManualCleanup, printCompletedStep, printStep } from './output.js';
import type { CliOptions, RuntimeConfig } from './types.js';

export async function deleteProject(
  options: CliOptions,
  config: RuntimeConfig
): Promise<void> {
  await confirmDelete(options, config);

  console.log('\nDeleting TanStarter resources...');

  const failures: string[] = [];
  const steps: Array<{
    label: string;
    action: () => Promise<void> | void;
  }> = [
    { label: 'Cloudflare Worker', action: () => deleteWorker(config) },
    { label: 'KV namespace', action: () => deleteKV(config) },
    { label: 'R2 bucket', action: () => deleteR2(config) },
    { label: 'D1 database', action: () => deleteD1(config) },
    {
      label: 'GitHub repo',
      action: () => deleteGithubRepo(options, config),
    },
  ];

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

  console.log('\nTanStarter resources were deleted.');
  console.log(`Local project directory was left in place: ${config.targetDir}`);
}

async function runDeleteStep(
  failures: string[],
  label: string,
  action: () => Promise<void> | void
): Promise<void> {
  try {
    await action();
    printCompletedStep(`Delete ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAlreadyDeleted(message)) {
      console.log(`✅ ${label} was already deleted.`);
      return;
    }
    if (message.includes('delete_repo')) {
      console.error(
        '\nGitHub CLI is missing repository delete permission. Run:\n' +
          '  gh auth refresh -h github.com -s delete_repo'
      );
    }

    console.error(`\nCould not delete ${label}:\n${message}`);
    failures.push(label);
  }
}

function isAlreadyDeleted(message: string): boolean {
  return [
    'Worker does not exist',
    'namespace not found',
    'specified bucket does not exist',
    'could not be found',
    'Could not resolve to a Repository',
    'Not Found',
  ].some((pattern) => message.includes(pattern));
}

async function confirmDelete(
  options: CliOptions,
  config: RuntimeConfig
): Promise<void> {
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

  // Without a TTY the two gates below cannot run — there is no prompt to
  // answer. Returning here would delete everything with zero confirmation,
  // which is the exact opposite of what the gates exist for, and a pipe, a CI
  // job or an agent shelling out is the common case rather than the exception.
  // Nothing this command does can be undone, so refuse instead.
  if (!process.stdin.isTTY) {
    throw new Error(
      [
        'Delete needs an interactive terminal.',
        'stdin is not a TTY, so the two confirmations cannot be answered.',
        'Run tanstarter delete directly in a terminal.',
      ].join('\n')
    );
  }

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
}
