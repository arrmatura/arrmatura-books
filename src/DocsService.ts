import { WebClientService } from "arrmatura-web/core";
import { cached } from "./sessionCache";
import { markdownToNodes } from "arrmatura-markdown";
import { XmlNode } from "ultimus";
import { parseFrontmatter } from "arrmatura-markdown";

/**
 * Loads the currently selected document of a markdown docs corpus (`doc`, resolved
 * through `docUrl`). The site tree it belongs to is `BookIndexTreeService`'s.
 *
 * Apps subclass this to add their own state; the kit registers it as-is.
 */
export class DocsService extends WebClientService {
  loading = false;
  error = "";
  docUrl = "/docs/*";
  #doc: string = "";
  #text: string = "";
  prefix: string = "Book";
  key: string = "";
  declare progress: Record<string, boolean>;
  declare opened: Record<string, boolean>;
  declare expandedAll: boolean;

  constructor() {
    super();

    this.__defineStoredProperty("progress", (v) => v ?? {});
    this.__defineStoredProperty("opened", (v) => v ?? {});
    this.__defineStoredProperty("expandedAll", (v) => v ?? false);
  }

  toggleProgress(id: string) {
    const current = this.progress[id] ?? false;
    this.up({ progress: { ...this.progress, [id]: !current } });
  }

  toggleOpened(id: string) {
    const current = this.opened[id] ?? this.expandedAll ?? false;
    this.up({ opened: { ...this.opened, [id]: !current } });
  }

  expandAll() {
    this.up({ expandedAll: true });
  }

  collapseAll() {
    this.up({
      expandedAll: false,
      ...(!this.expandedAll ? { opened: {} } : {}),
    });
  }

  get text() {
    return this.#text;
  }

  set text(text: string) {
    this.#text = text;
    this._load(this.#text);
  }

  private _load(text: string) {
    if (!text) {
      this.up({ nodes: null });
      return;
    }
    try {
      const { attrs, body } = parseFrontmatter(text);
      const mdKey = this.doc;
      const document: XmlNode = {
        tag: this.prefix ? `MDDocument.${this.prefix}` : "MDDocument",
        id: mdKey,
        attrs: attrs as XmlNode["attrs"],
        nodes: markdownToNodes(body, this.prefix || "MD", mdKey),
      };
      this.up({ mdKey, attrs, nodes: [document] });
    } catch (err) {
      this.up({ error: String(err), nodes: null });
    }
  }

  get doc() {
    return this.#doc;
  }

  set doc(id: string) {
    if (!id) return;
    this.#doc = id;

    const url = this.docUrl.replace("*", id);

    this.up({ loading: true, error: "", doc: id });

    cached(url, () => this.fetch(url))
      .then((text) => ({ text }))
      .catch((err) => ({ error: String(err), text: "" }))
      .then((patch) => {
        // prevent race-condition
        if (this.doc !== id) return;

        this.up({ ...patch, loading: false });
      });
  }
}
