import fs from 'node:fs';
import path from 'node:path';

import type { RuntimeConfig } from './types.js';

const PRESET_FILE = path.join('src', 'config', 'preset.ts');

/**
 * The template declares the active tier as a single literal. Match that exact
 * line instead of rewriting the file, so template-side comment edits around it
 * keep working.
 */
const ACTIVE_PRESET_PATTERN =
  /^(export const ACTIVE_PRESET: PresetName = )'(?:free|account|full)';$/m;

export function updatePackageName(config: RuntimeConfig): void {
  const packagePath = path.join(config.targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
    name?: string;
  };
  packageJson.name = config.projectName;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

/**
 * Writes the chosen tier into the generated project. A miss must fail loudly:
 * silently skipping would ship a project whose tier disagrees with what the
 * user picked, and that disagreement only surfaces after they go live.
 */
export function writePresetConfig(config: RuntimeConfig): void {
  const presetPath = path.join(config.targetDir, PRESET_FILE);

  if (!fs.existsSync(presetPath)) {
    throw new Error(
      [
        `Could not find ${PRESET_FILE} in the generated project.`,
        'The cloned template predates the preset layer, so --preset cannot be applied.',
        'Update the template, or use a CLI version matching it.',
      ].join('\n')
    );
  }

  const source = fs.readFileSync(presetPath, 'utf8');
  if (!ACTIVE_PRESET_PATTERN.test(source)) {
    throw new Error(
      [
        `Could not find the ACTIVE_PRESET declaration in ${PRESET_FILE}.`,
        "Expected a line shaped like: export const ACTIVE_PRESET: PresetName = 'full';",
        'The template changed that file; update the CLI to match before continuing.',
      ].join('\n')
    );
  }

  fs.writeFileSync(
    presetPath,
    source.replace(ACTIVE_PRESET_PATTERN, `$1'${config.preset}';`),
    'utf8'
  );
}
