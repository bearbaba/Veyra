/**
 * Policy for the package scripts of the Arc Studio workspace root.
 *
 * The workspace root holds an outdated snapshot of the application (Oct 31).
 * Every script there must either run THIS repository deliberately or refuse;
 * none may silently run the snapshot. Environment tooling only: the Veyra
 * application does not import this file.
 */

/** Scripts that are safe to run from the root by delegating to the repository. */
export const SAFE_DELEGATED_SCRIPTS = [
  'lint',
  'lint:fix',
  'typecheck',
  'check',
  'test',
  'test:watch',
  'contracts:build',
  'contracts:test',
  'check:dev-isolation',
  'check:prod-bundle',
  'check:repository-trust',
  'check:vercel-preview-bundle',
] as const;

/** Scripts with a dedicated, guarded Studio launcher. */
export const GUARDED_LAUNCHERS = {
  dev: 'dev.sh',
  build: 'build.sh',
  server: 'local-backend.sh',
} as const;

export type ScriptMap = Record<string, string>;

/**
 * Build the root `scripts` map. `rel` is the repository path relative to the
 * workspace root (for example `Veyra-github`). Every script name found in either
 * the root or the repository is mapped, so nothing can fall through unchanged.
 */
export function buildRootScripts(
  rootScripts: ScriptMap,
  repoScripts: ScriptMap,
  rel: string,
): ScriptMap {
  const names = new Set([
    ...Object.keys(rootScripts),
    ...Object.keys(repoScripts),
    ...Object.keys(GUARDED_LAUNCHERS),
  ]);
  const delegated = new Set<string>(SAFE_DELEGATED_SCRIPTS);
  const out: ScriptMap = {};
  for (const name of [...names].sort()) {
    if (name in GUARDED_LAUNCHERS) {
      out[name] = `bash ${rel}/studio/${GUARDED_LAUNCHERS[name as keyof typeof GUARDED_LAUNCHERS]}`;
    } else if (delegated.has(name) && name in repoScripts) {
      out[name] = `bun run --cwd ${rel} ${name}`;
    } else {
      out[name] = `bash ${rel}/studio/refuse.sh ${name}`;
    }
  }
  return out;
}

/** Names of root scripts that would still run the snapshot (empty when safe). */
export function findUnsafeRootScripts(scripts: ScriptMap, rel: string): string[] {
  const safePrefixes = [`bash ${rel}/studio/`, `bun run --cwd ${rel} `];
  return Object.entries(scripts)
    .filter(([, command]) => !safePrefixes.some((prefix) => command.startsWith(prefix)))
    .map(([name]) => name);
}
