/// <reference types="node" />
import * as fs from "node:fs";
import * as path from "node:path";

import { parseJson, str } from "ultimus";

export type Path = string | string[];

export type FileOp<T = any> = (arg0: string, dir: string) => T | null;

export const filePath = (f: Path) => (Array.isArray(f) ? path.join(...f) : f);

export const fileExists = (f: Path) => fs.existsSync(filePath(f));

export function stringifyJson(x: unknown, indent = 2) {
  if (!x) return str(x);
  if (Array.isArray(x))
    return `[\n${x.map((e) => JSON.stringify(e)).join("\n,")}\n]`;
  if (typeof x === "object")
    return (
      "{\n" +
      Object.keys(x)
        .sort()
        .map((id) => `"${id}": ${JSON.stringify(x[id])}`)
        .join(",\n") +
      "\n}"
    );
  return JSON.stringify(x, null, indent);
}

/**
 * Ensure that the path for the given file exists by creating any missing directories recursively.
 *
 * @param {string} filePath - The path of the file.
 */
export function ensurePathForFile(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return filePath;
}

export const isDirectory = (f: Path) =>
  fileExists(f) && fs.statSync(filePath(f)).isDirectory();

export const writeFileContent = (f: Path, c: string | Promise<string>) => {
  if (c == null) return;
  if (c instanceof Promise) return c.then((x) => writeFileContent(f, x));
  if (typeof c === "string") {
    fs.writeFileSync(ensurePathForFile(filePath(f)), str(c).trim(), "utf8");
  }
};

export const writeFileJsonContent = (f: Path, x: any) => {
  if (x == null) return;
  fs.writeFileSync(ensurePathForFile(filePath(f)), stringifyJson(x), "utf8");
  return x;
};

export const readFileContent = (f: Path, def = "") =>
  fileExists(f) ? fs.readFileSync(filePath(f), "utf8").toString() : def;

export const readFileJsonContent = (f: Path, def: any = null) =>
  parseJson(readFileContent(f), def);
