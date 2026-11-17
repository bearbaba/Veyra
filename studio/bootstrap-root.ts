/**
 * Points the Arc Studio workspace root at this repository.
 *
 *   bun run studio/bootstrap-root.ts <workspace-root> <repo-dir>          apply
 *   bun run studio/bootstrap-root.ts <workspace-root> <repo-dir> --verify check only
 *
 * Only the root package.json `scripts` are rewritten. Dependencies, the lockfile
 * and every other root file are left alone, and the original package.json is kept
 * once as package.json.snapshot-original.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { buildRootScripts, findUnsafeRootScripts, type ScriptMap } from './rootScripts';

interface PackageJson {
  scripts?: ScriptMap;
  [key: string]: unknown;
}

const [rootArg, repoArg, flag] = process.argv.slice(2);
if (!rootArg || !repoArg) {
  console.error('usage: bootstrap-root.ts <workspace-root> <repo-dir> [--verify]');
  process.exit(2);
}
const root = resolve(rootArg);
const repo = resolve(repoArg);
const rel = relative(root, repo);
if (!rel || rel.startsWith('..')) {
  console.error(`[studio] ${repo} must be inside the workspace root ${root}.`);
  process.exit(2);
}

const rootPkgPath = resolve(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as PackageJson;
const repoPkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')) as PackageJson;

if (flag === '--verify') {
  const unsafe = findUnsafeRootScripts(rootPkg.scripts ?? {}, rel);
  if (unsafe.length > 0) {
    console.error(`[studio] Root scripts that would run the snapshot: ${unsafe.join(', ')}`);
    process.exit(1);
  }
  console.log(`[studio] OK: all ${Object.keys(rootPkg.scripts ?? {}).length} root scripts delegate to ${rel}/ or refuse.`);
  process.exit(0);
}

const backup = `${rootPkgPath}.snapshot-original`;
if (!existsSync(backup)) copyFileSync(rootPkgPath, backup);

rootPkg.scripts = buildRootScripts(rootPkg.scripts ?? {}, repoPkg.scripts ?? {}, rel);
writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);

// Legacy launcher path from earlier Studio setups: keep it, but make it a thin forwarder.
const legacy = resolve(root, 'scripts/studio-dev.sh');
if (existsSync(resolve(root, 'scripts'))) {
  writeFileSync(legacy, `#!/usr/bin/env bash\n# Forwarder. The launcher lives in the repository: ${rel}/studio/dev.sh\nexec bash "$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/${rel}/studio/dev.sh" "$@"\n`, { mode: 0o755 });
}

const counts = Object.values(rootPkg.scripts).reduce(
  (acc, command) => {
    acc[command.includes('/studio/refuse.sh') ? 'refused' : 'mapped'] += 1;
    return acc;
  },
  { mapped: 0, refused: 0 },
);
console.log(`[studio] Root scripts now point at ${rel}/ (${counts.mapped} mapped, ${counts.refused} refuse). Backup: package.json.snapshot-original`);
