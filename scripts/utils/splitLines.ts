/** Splits `text` into lines the way Python's `str.splitlines()` does: no trailing empty line. */
export function splitLines(text: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: \x1c-\x1e are Python's line separators too
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
