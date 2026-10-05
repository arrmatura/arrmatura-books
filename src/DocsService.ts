import { WebClientService } from "arrmatura-web/core";
import { cached } from "./sessionCache";

/**
 * Loads the currently selected document of a markdown docs corpus (`doc`, resolved
 * through `docUrl`). The site tree it belongs to is `BookIndexTreeService`'s.
 *
 * Apps subclass this to add their own state; the kit registers it as-is.
 */
export class DocsService extends WebClientService {
  text = "";
  loading = false;
  error = "";
  /** Id of the currently loaded document. */
  docId = "";
  docUrl = "/docs/*";

  set doc(id: string) {
    if (!id) return;
    const url = this.docUrl.replace("*", id);
    this.up({ loading: true, error: "", docId: id });
    cached(url, () => this.fetch(url))
      .then((text) => ({ text }))
      .catch((err) => ({ error: String(err), text: "" }))
      .then((patch) => {
        // A slow response for a document the reader has already navigated away from must
        // not land: `docId` names the current selection, and the newer load clears `loading`.
        if (this.docId !== id) return;
        this.up({ ...patch, loading: false });
      });
  }
}
