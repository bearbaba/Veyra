/**
 * Minimal Bun global type stubs for script files.
 * These are only needed because scripts/ is included in tsconfig.json.
 * Full types available via @types/bun — this stub covers what cctp-e2e.ts uses.
 */

/* eslint-disable */
declare namespace Bun {
  function file(path: string): BunFile;
  function write(path: string, content: string | Uint8Array): Promise<number>;
  interface BunFile {
    text(): Promise<string>;
    exists(): Promise<boolean>;
  }
}
