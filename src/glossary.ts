/** A book's terms, each keyed as written, with every other spelling a page may use for it. */
export type Glossary = Record<string, { labels: string[]; definition: string }>;

/** The definition of `text`: a term's own key wins over another term's label; among labels, the earliest term wins. */
export function glossaryDefinition(glossary: Glossary, text: string): string | undefined {
  const entry = Object.hasOwn(glossary, text)
    ? glossary[text]
    : Object.values(glossary).find(({ labels }) => labels.includes(text));
  return entry?.definition;
}
