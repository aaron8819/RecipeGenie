import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const stylePath = /^web\/src\/(?:components\/[^\0\r\n]+|app\/globals)\.css$/;
const imagePath = /^web\/public\/[^\0\r\n]+\.(?:png|jpg|jpeg|webp|ico)$/;

// Only styles and inert image assets can bypass historical migration rehearsals.
// Application logic, tests, contracts, tooling and unknown paths retain the full run.
export function requiresMigrationRehearsals(files) {
  if (!Array.isArray(files) || files.length === 0) return true;
  return files.some(
    (file) =>
      typeof file !== 'string' ||
      (!stylePath.test(file) && !imagePath.test(file)) ||
      file.includes('\\') ||
      file.split('/').some((segment) => segment === '..' || segment === '.' || segment === ''),
  );
}

export function rehearsalScope(
  base,
  head,
  git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
) {
  try {
    if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? '') && !/^0+$/.test(sha))) {
      return true;
    }
    if (
      git(['rev-parse', '--verify', `${base}^{commit}`]).trim() !== base ||
      git(['rev-parse', '--verify', `${head}^{commit}`]).trim() !== head
    )
      return true;
    const output = git(['diff', '--no-renames', '--name-only', '-z', base, head, '--']);
    if (!output.endsWith('\0')) return true;
    return requiresMigrationRehearsals(output.slice(0, -1).split('\0'));
  } catch {
    return true;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const full = rehearsalScope(process.env.REHEARSAL_BASE_SHA, head);
  if (!process.env.GITHUB_OUTPUT) throw new Error('Workflow output destination required');
  appendFileSync(process.env.GITHUB_OUTPUT, `full=${full}\n`);
  console.log(
    full
      ? 'Full migration rehearsals required'
      : 'Styles/assets only: historical rehearsals omitted; security and schema checks retained',
  );
}
