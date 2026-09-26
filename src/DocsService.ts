import { WebClientService } from "arrmatura-web/core";

/**
 * Loads the currently selected document of a markdown docs corpus (`doc`, resolved
 * through `resolveUrlPattern`). The site tree it belongs to is `BookIndexTreeService`'s.
 *
 * Apps subclass this to add their own state; the kit registers it as-is.
 */
export class DocsService extends WebClientService {
  text = "";
  loading = false;
  error = "";
  /** Id of the currently loaded document. */
  docId = "";
  resolveUrlPattern = "/docs/*";

  set doc(id: string) {
    if (!id) return;
    this.up({ loading: true, error: "", docId: id });
    this.fetch(this.resolveUrlPattern.replace("*", id))
      .then((text) => ({ text }))
      .catch((err) => ({ error: String(err), text: "" }))
      .then((patch) => {
        this.up({ ...patch, loading: false });
      });
  }
}
