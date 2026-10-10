import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const DEV_MARKERS = [
  'CCTP V2 E2E Validation',
  'Developer tools are not available in production',
  'RESUME_DETECTED',
];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

const files = await walk(DIST);
const violations: string[] = [];

for (const path of files) {
  if (!/\.(?:js|html|css)$/.test(path)) continue;
  const content = await readFile(path, 'utf8');
  if (DEV_MARKERS.some((marker) => content.includes(marker))) {
    violations.push(path);
  }
}

if (violations.length > 0) {
  throw new Error(
    `Production bundle contains DEV tooling markers: ${violations.join(', ')}`,
  );
}

console.log('Production bundle DEV isolation OK.');
