import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Whether a tool is installed: it runs, whatever it answers. */
export function hasTool(command: string, probe: readonly string[]): boolean {
  return spawnSync(command, probe, { encoding: "utf8" }).error === undefined;
}

/** Runs a tool on a temporary copy of `bytes` and removes the copy. */
export function runOn(bytes: Uint8Array, fileName: string, command: string, args: (path: string) => readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const directory = mkdtempSync(join(tmpdir(), "kin-documents-"));
  try {
    const path = join(directory, fileName);
    writeFileSync(path, bytes);
    return spawnSync(command, args(path), { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
