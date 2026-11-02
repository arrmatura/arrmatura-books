/** The singular of `word`, by spelling alone: `Goals` -> `Goal`, `Weaknesses` -> `Weakness`, `Success` stays. */
export function lemma(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  return /[^sui]s$/.test(word) ? word.slice(0, -1) : word;
}

/** The definition of `text`: its own spelling first, since `Parameters` can mean more than `Parameter` does. */
export function glossaryDefinition(glossary: Record<string, string>, text: string): string | undefined {
  return [text, lemma(text)].filter((key) => Object.hasOwn(glossary, key)).map((key) => glossary[key])[0];
}
