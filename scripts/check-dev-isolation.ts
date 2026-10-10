import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');
const ALLOWED_PREFIX = ['components', 'dev'].join(sep);
const ALLOWED_ENTRY = 'dev.tsx';

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

const sourceFiles = (await walk(SRC_ROOT)).filter(
  (path) => path.endsWith('.ts') || path.endsWith('.tsx'),
);

const violations: string[] = [];

for (const path of sourceFiles) {
  const rel = relative(SRC_ROOT, path);
  if (rel === ALLOWED_ENTRY || rel.startsWith(`${ALLOWED_PREFIX}${sep}`)) {
    continue;
  }

  const content = await readFile(path, 'utf8');
  if (
    /(?:from\s*|import\s*\()\s*['"][^'"]*components\/dev\//.test(content)
  ) {
    violations.push(rel);
  }
}

if (violations.length > 0) {
  throw new Error(
    `Production source imports DEV modules: ${violations.join(', ')}`,
  );
}

console.log(
  `DEV isolation OK: ${sourceFiles.length} TypeScript source files checked.`,
);
