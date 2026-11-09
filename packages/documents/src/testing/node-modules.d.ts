/*
 * The few Node APIs the tests use to check output with the machine's own tools
 * (unzip, python3, pdftotext). @kin/documents does not depend on @types/node,
 * and a test helper is no reason to add a dependency, so these are declared by
 * hand. If @types/node is ever added to this package, delete this file.
 */
declare module "node:child_process" {
  export function spawnSync(command: string, args: readonly string[], options?: { encoding: "utf8" }): { status: number | null; stdout: string; stderr: string; error?: Error };
}
declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: Uint8Array): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
