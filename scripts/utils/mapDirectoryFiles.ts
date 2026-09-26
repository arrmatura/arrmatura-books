import type { Dirent } from "node:fs";
import * as fs from "node:fs";
import { filePath, isDirectory } from "./files";

/**
 * Maps files in a directory and applies a function to each file.
 *
 * @param {string} d - The directory path to map files from.
 * @param {FileOp} fn - The function to apply to each file.
 * @param {options.recurrsive}  - The recursion mode.
 * @return {*} - A flatten result of mapping files in the directory.
 */
export const mapDirectoryFiles = <T>(
  rootDir: string,
  fn: (f: Dirent, dir: string, rootDir: string) => T | null,
  { recursive = true }: { recursive?: boolean } = {},
): Array<T> => {
  const path = filePath(rootDir);
  if (!isDirectory(path)) return [];

  return fs
    .readdirSync(path, { withFileTypes: true, recursive })
    .filter((f: Dirent) => !f.isDirectory())
    .sort((a, b) => a?.name.localeCompare(b.name))
    .map((f) =>
      fn(
        f,
        f.parentPath === path ? "" : f.parentPath.slice(path.length + 1),
        path,
      ),
    )
    .filter((f) => f != null);
};
